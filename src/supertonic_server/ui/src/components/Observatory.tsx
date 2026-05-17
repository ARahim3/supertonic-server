import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MetricsSummary, RecentRecord } from '../types';
import { getMetricsRecent, getMetricsSummary } from '../api';

const POLL_MS = 1000;

export function Observatory() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [records, setRecords] = useState<RecentRecord[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  const tick = useCallback(async (signal: AbortSignal) => {
    try {
      const [s, r] = await Promise.all([
        getMetricsSummary(signal),
        getMetricsRecent(50, signal),
      ]);
      setSummary(s);
      setRecords(r.data);
      setError(null);
    } catch (e: unknown) {
      const ae = e as { name?: string; message?: string };
      if (ae?.name === 'AbortError') return;
      setError(ae?.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    tick(ctrl.signal); // initial fetch

    const id = window.setInterval(() => {
      if (paused || cancelled) return;
      tick(ctrl.signal);
    }, POLL_MS);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, [tick, paused]);

  const selectedRec = useMemo(
    () => (selected != null ? records.find((r) => r.id === selected) ?? null : null),
    [selected, records],
  );

  return (
    <div className="space-y-7">
      {/* HEADER STRIP — totals + live aggregates */}
      <Header summary={summary} paused={paused} onTogglePause={() => setPaused((p) => !p)} />

      {error && (
        <div className="text-[11px] text-[var(--color-red)] tracking-[0.04em]">
          ⚠ {error}
        </div>
      )}

      {/* PERCENTILES + REQUEST FEED */}
      <div className="grid grid-cols-12 gap-7">
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <PctCard
            title="time to first byte"
            unit="ms"
            p50={summary?.window.ttfb_ms.p50}
            p95={summary?.window.ttfb_ms.p95}
            p99={summary?.window.ttfb_ms.p99}
            count={summary?.window.ttfb_ms.count}
            fmt={(n) => n.toFixed(0)}
          />
          <PctCard
            title="real-time factor"
            unit="×"
            p50={summary?.window.rtf.p50}
            p95={summary?.window.rtf.p95}
            p99={summary?.window.rtf.p99}
            count={summary?.window.rtf.count}
            fmt={(n) => n.toFixed(3)}
            invert /* lower RTF is better, color the low end phos */
          />
        </div>

        <div className="col-span-12 lg:col-span-8">
          <RequestFeed
            records={records}
            selected={selected}
            onSelect={(id) => setSelected(id === selected ? null : id)}
          />
        </div>
      </div>

      {/* DETAIL VIEW */}
      {selectedRec && <Detail record={selectedRec} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ====================================================================== */
/*  Header — uptime, active count, totals, rps, error rate, pause toggle   */
/* ====================================================================== */

function Header({
  summary,
  paused,
  onTogglePause,
}: {
  summary: MetricsSummary | null;
  paused: boolean;
  onTogglePause: () => void;
}) {
  return (
    <section className="rise d1">
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-[10px] tracking-[0.22em] uppercase font-semibold text-[var(--color-fg-2)]">
          <span className="text-[var(--color-fg-4)]">03 · </span>OBSERVATORY
        </span>
        <div className="flex items-center gap-3 text-[10px] tracking-[0.06em] text-[var(--color-fg-4)]">
          <span>
            uptime <span className="numb text-[var(--color-fg-3)]">{fmtUptime(summary?.uptime_s ?? 0)}</span>
          </span>
          <span>·</span>
          <button
            onClick={onTogglePause}
            className="text-[var(--color-fg-3)] hover:text-[var(--color-fg)] tracking-[0.08em]"
            title={paused ? 'resume polling' : 'pause polling'}
          >
            {paused ? '▶ resume' : '⏸ pause'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <StatCell
          label="active"
          value={summary ? String(summary.active) : '—'}
          accent={!!summary && summary.active > 0}
          dot={!!summary && summary.active > 0}
        />
        <StatCell
          label="requests"
          value={summary ? summary.totals.requests.toLocaleString() : '—'}
        />
        <StatCell
          label="rps · 1m"
          value={summary ? summary.window.rps_1m.toFixed(2) : '—'}
        />
        <StatCell
          label="errors"
          value={summary ? String(summary.totals.error) : '—'}
          accent={!!summary && summary.totals.error > 0}
          tone={summary && summary.totals.error > 0 ? 'red' : undefined}
        />
        <StatCell
          label="audio served"
          value={summary ? fmtAudioS(summary.totals.audio_s) : '—'}
        />
        <StatCell
          label="bytes served"
          value={summary ? fmtBytes(summary.totals.bytes) : '—'}
          noBorderRight
        />
      </div>
    </section>
  );
}

function StatCell({
  label,
  value,
  accent,
  dot,
  tone,
  noBorderRight,
}: {
  label: string;
  value: string;
  accent?: boolean;
  dot?: boolean;
  tone?: 'red' | 'phos';
  noBorderRight?: boolean;
}) {
  const color =
    tone === 'red' ? 'text-[var(--color-red)]' :
    accent ? 'phos-text' :
    'text-[var(--color-fg)]';
  return (
    <div
      className={
        'p-3 flex flex-col gap-1 min-h-[68px] ' +
        (noBorderRight ? '' : 'md:border-r border-[var(--color-border)]')
      }
    >
      <div className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-3)]">
        {label}
      </div>
      <div className={'numb text-[18px] leading-none ' + color}>
        {dot && <span className="led mr-2 inline-block" style={{ width: 6, height: 6 }} />}
        {value}
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  Percentile card — p50 / p95 / p99                                       */
/* ====================================================================== */

function PctCard({
  title,
  unit,
  p50,
  p95,
  p99,
  count,
  fmt,
  invert,
}: {
  title: string;
  unit: string;
  p50?: number;
  p95?: number;
  p99?: number;
  count?: number;
  fmt: (n: number) => string;
  invert?: boolean;
}) {
  // The "primary" / "good" reading is p50; we make it visually loud.
  // RTF is "good when low," TTFB is "good when low" too — same direction;
  // `invert` exists for future metrics where higher is better.
  void invert;
  const rows: { k: string; v?: number }[] = [
    { k: 'p50', v: p50 },
    { k: 'p95', v: p95 },
    { k: 'p99', v: p99 },
  ];
  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)] rise d2">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)]">
        <span className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-3)]">
          {title}
        </span>
        <span className="text-[9px] tracking-[0.1em] tabular-nums text-[var(--color-fg-4)]">
          n={count ?? 0}
        </span>
      </div>
      <div className="p-3 space-y-2">
        {rows.map(({ k, v }) => (
          <div key={k} className="flex items-baseline justify-between">
            <span className="text-[10px] tracking-[0.1em] uppercase text-[var(--color-fg-4)] w-10">
              {k}
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className={(k === 'p50' ? 'phos-text font-semibold text-[18px]' : 'text-[var(--color-fg-2)] text-[14px]') + ' numb'}>
                {v != null ? fmt(v) : '—'}
              </span>
              <span className="text-[10px] text-[var(--color-fg-4)] tracking-[0.04em]">{unit}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ====================================================================== */
/*  Request feed — newest-first list, click a row to expand                 */
/* ====================================================================== */

function RequestFeed({
  records,
  selected,
  onSelect,
}: {
  records: RecentRecord[];
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const maxTotal = useMemo(
    () => Math.max(1, ...records.map((r) => r.total_ms)),
    [records],
  );

  return (
    <div className="border border-[var(--color-border)] bg-[var(--color-surface)] rise d3">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <span className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-3)]">
          recent requests
        </span>
        <span className="text-[9px] tracking-[0.1em] tabular-nums text-[var(--color-fg-4)]">
          {records.length} shown · newest first
        </span>
      </div>

      <div className="max-h-[460px] overflow-y-auto">
        {records.length === 0 ? (
          <div className="p-6 text-[11px] text-[var(--color-fg-4)] tracking-[0.06em] text-center">
            no requests yet — run a synthesis from the console or via the API
          </div>
        ) : (
          <ul>
            {records.map((r) => (
              <FeedRow
                key={r.id}
                r={r}
                isSelected={selected === r.id}
                onClick={() => onSelect(r.id)}
                maxTotal={maxTotal}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FeedRow({
  r,
  isSelected,
  onClick,
  maxTotal,
}: {
  r: RecentRecord;
  isSelected: boolean;
  onClick: () => void;
  maxTotal: number;
}) {
  const totalPct = Math.max(2, (r.total_ms / maxTotal) * 100);
  const ttfbPct = Math.max(0, (r.ttfb_ms / maxTotal) * 100);

  const statusBadge =
    r.status === 'ok' ? <Badge tone="phos">ok</Badge> :
    r.status === 'cancelled' ? <Badge tone="amber">cancelled</Badge> :
    <Badge tone="red">error</Badge>;

  return (
    <li
      onClick={onClick}
      className={
        'cursor-pointer border-b border-[var(--color-border)] last:border-b-0 px-3 py-2.5 hover:bg-[var(--color-surface-2)] transition-colors ' +
        (isSelected ? 'bg-[var(--color-surface-2)]' : '')
      }
    >
      <div className="flex items-center gap-3 text-[11px]">
        <span className="numb text-[var(--color-fg-4)] w-7 shrink-0">#{r.id}</span>
        <span className="text-[10px] tracking-[0.06em] text-[var(--color-fg-3)] w-12 shrink-0 uppercase">
          {r.transport}
        </span>
        <span className="text-[10px] tracking-[0.06em] text-[var(--color-fg-3)] w-14 shrink-0 uppercase">
          {r.format}
        </span>
        <span className="text-[10px] phos-text w-7 shrink-0 tabular-nums">{r.voice}</span>
        <span className="text-[10px] text-[var(--color-fg-3)] w-7 shrink-0 numb">{r.lang}</span>
        <span className="flex-1 truncate text-[var(--color-fg-2)]">
          {r.text_snippet || '—'}
        </span>
        <span className="numb text-[10px] text-[var(--color-fg-3)] w-16 text-right shrink-0">
          {r.ttfb_ms.toFixed(0)} ms
        </span>
        <span className="numb text-[10px] text-[var(--color-fg-3)] w-16 text-right shrink-0">
          {(r.total_ms / 1000).toFixed(2)} s
        </span>
        <span className="numb text-[10px] phos-text w-12 text-right shrink-0">
          {r.rtf > 0 ? `${r.rtf.toFixed(2)}×` : '—'}
        </span>
        <span className="w-16 shrink-0 flex justify-end">{statusBadge}</span>
      </div>

      {/* waterfall bar */}
      <div className="relative mt-1.5 h-[3px] bg-[var(--color-border)]">
        <div
          className="absolute inset-y-0 left-0 bg-[var(--color-fg-4)]"
          style={{ width: `${ttfbPct}%` }}
          title={`ttfb ${r.ttfb_ms.toFixed(1)} ms`}
        />
        <div
          className="absolute inset-y-0 bg-[var(--color-phos)]"
          style={{ left: `${ttfbPct}%`, width: `${Math.max(0, totalPct - ttfbPct)}%` }}
          title={`stream ${(r.total_ms - r.ttfb_ms).toFixed(1)} ms`}
        />
      </div>
    </li>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'phos' | 'amber' | 'red';
}) {
  const color =
    tone === 'phos' ? 'phos-text border-[var(--color-phos-dim)] bg-[var(--color-phos-bg)]' :
    tone === 'amber' ? 'text-[var(--color-amber)] border-[var(--color-amber)] bg-[var(--color-amber-bg)]' :
    'text-[var(--color-red)] border-[var(--color-red)] bg-[var(--color-red-bg)]';
  return (
    <span
      className={
        'inline-block px-1.5 py-px text-[9px] tracking-[0.14em] uppercase border ' + color
      }
    >
      {children}
    </span>
  );
}

/* ====================================================================== */
/*  Detail panel — shown when a request is clicked                          */
/* ====================================================================== */

function Detail({ record, onClose }: { record: RecentRecord; onClose: () => void }) {
  return (
    <section className="border border-[var(--color-border)] bg-[var(--color-surface)] rise">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <span className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-3)]">
          request #{record.id} · detail
        </span>
        <button onClick={onClose} className="btn-ghost !text-[10px] !py-1">
          close ✕
        </button>
      </div>
      <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-3 text-[11px] tabular-nums">
        <KV k="started" v={new Date(record.started_at * 1000).toLocaleTimeString()} />
        <KV k="ended"   v={new Date(record.ended_at * 1000).toLocaleTimeString()} />
        <KV k="transport" v={record.transport} />
        <KV k="format" v={record.format} />
        <KV k="voice"  v={record.voice} />
        <KV k="lang"   v={record.lang} />
        <KV k="status" v={record.status} />
        <KV k="text length" v={`${record.text_length} chars`} />
        <KV k="ttfb"   v={`${record.ttfb_ms.toFixed(1)} ms`} />
        <KV k="total"  v={`${(record.total_ms / 1000).toFixed(3)} s`} />
        <KV k="audio"  v={record.audio_s > 0 ? `${record.audio_s.toFixed(3)} s` : '—'} />
        <KV k="rtf"    v={record.rtf > 0 ? `${record.rtf.toFixed(4)}` : '—'} />
        <KV k="bytes"  v={record.bytes.toLocaleString()} />
        <KV k="bitrate" v={record.audio_s > 0 ? `${((record.bytes * 8) / 1000 / record.audio_s).toFixed(1)} kbps` : '—'} />
        {record.error && <KV k="error" v={record.error} />}
      </div>
      <div className="border-t border-[var(--color-border)] p-4">
        <div className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-4)] mb-1">
          text snippet
        </div>
        <pre className="text-[12px] text-[var(--color-fg-2)] whitespace-pre-wrap break-words">
{record.text_snippet || '—'}
        </pre>
      </div>
    </section>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-4)]">{k}</span>
      <span className="text-[var(--color-fg-2)] break-words">{v}</span>
    </div>
  );
}

/* ====================================================================== */
/*  Formatters                                                              */
/* ====================================================================== */

function fmtUptime(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAudioS(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(2)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}
