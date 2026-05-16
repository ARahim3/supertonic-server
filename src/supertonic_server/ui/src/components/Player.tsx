import { useEffect, useMemo, useRef, useState } from 'react';
import type { SynthesisStats } from '../types';
import { Waveform } from './Waveform';

type Props = {
  blob: Blob | null;
  stats: SynthesisStats | null;
  peaks: number[];
  busy: boolean;
  filename: string;
};

const fmtTime = (s: number) => {
  if (!isFinite(s) || s < 0) return '00:00';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${ss.toString().padStart(2, '0')}`;
};

export function Player({ blob, stats, peaks, busy, filename }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  useEffect(() => {
    if (!blob || !audioRef.current) return;
    audioRef.current.play().catch(() => {});
  }, [blob]);

  const progress = duration > 0 ? t / duration : 0;

  return (
    <section className="flex flex-col gap-3 rise d2">
      {/* numbered header — "02 · OUTPUT" */}
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-[0.22em] uppercase font-semibold text-[var(--color-fg-2)]">
          <span className="text-[var(--color-fg-4)]">02 · </span>OUTPUT
        </span>
        {blob && (
          <span className="text-[10px] text-[var(--color-fg-4)] tracking-[0.04em] truncate max-w-[60%]">
            {filename}
          </span>
        )}
      </div>

      {/* big waveform stage */}
      <div className="relative bg-[var(--color-base)] border border-[var(--color-border)]">
        <Waveform peaks={peaks} progress={progress} busy={busy && peaks.length === 0} height={220} />
        <div className="absolute left-3 right-3 bottom-2 flex justify-between text-[10px] tracking-[0.08em] tabular-nums pointer-events-none">
          <span className="phos-text">{fmtTime(t)}</span>
          <span className="text-[var(--color-fg-4)]">{fmtTime(duration)}</span>
        </div>
      </div>

      {/* transport */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            const a = audioRef.current;
            if (!a) return;
            if (a.paused) a.play();
            else a.pause();
          }}
          disabled={!blob}
          className={
            'w-9 h-9 flex items-center justify-center border transition-all ' +
            (blob
              ? 'border-[var(--color-phos)] bg-[var(--color-phos-bg)] phos-text hover:bg-[var(--color-phos)] hover:text-[var(--color-base)]'
              : 'border-[var(--color-border)] text-[var(--color-fg-4)] cursor-not-allowed')
          }
          aria-label="play / pause"
        >
          {playing ? (
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
              <rect x="2" y="1.5" width="2.6" height="9" fill="currentColor" />
              <rect x="7.4" y="1.5" width="2.6" height="9" fill="currentColor" />
            </svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
              <path d="M3 2L10 6L3 10Z" fill="currentColor" />
            </svg>
          )}
        </button>

        <input
          type="range"
          className="fader flex-1"
          min={0}
          max={duration || 1}
          step={0.01}
          value={t}
          disabled={!blob}
          onChange={(e) => {
            if (!audioRef.current) return;
            audioRef.current.currentTime = parseFloat(e.target.value);
          }}
          style={{ ['--pct' as string]: `${progress * 100}%` }}
        />

        <a
          href={url || '#'}
          download={blob ? filename : undefined}
          className={'btn-ghost ' + (!blob ? 'opacity-40 pointer-events-none' : '')}
          title="download audio"
        >
          <DownloadIcon /> Download
        </a>
      </div>

      {/* one-line perf summary with details disclosure */}
      <div className="border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <div className="flex items-center px-4 py-2.5 text-[11px] tabular-nums tracking-[0.02em]">
          {stats ? (
            <>
              <PerfBlock primary value={fmtRtf(stats.rtf)} label="realtime" />
              <Sep />
              <PerfBlock value={`${stats.ttfb_ms.toFixed(0)}ms`} label="first byte" />
              <Sep />
              <PerfBlock value={`${(stats.total_ms / 1000).toFixed(2)}s`} label="total" />
              <Sep />
              <PerfBlock value={`${(stats.bytes / 1024).toFixed(1)}kb`} />
            </>
          ) : (
            <span className="text-[var(--color-fg-4)] tracking-[0.06em]">
              run a synthesis to see performance
            </span>
          )}
          <button
            disabled={!stats}
            onClick={() => setShowDetails((s) => !s)}
            className="ml-auto text-[10px] text-[var(--color-fg-3)] hover:text-[var(--color-fg)] tracking-[0.08em] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {showDetails ? 'hide details' : 'details ↗'}
          </button>
        </div>

        {showDetails && stats && (
          <div className="border-t border-[var(--color-border)] px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-[11px] tabular-nums">
            <DetailKV k="ttfb"  v={`${stats.ttfb_ms.toFixed(1)} ms`} />
            <DetailKV k="total" v={`${(stats.total_ms / 1000).toFixed(3)} s`} />
            <DetailKV k="audio" v={stats.audio_s > 0 ? `${stats.audio_s.toFixed(3)} s` : '—'} />
            <DetailKV k="rtf"   v={stats.rtf > 0 ? stats.rtf.toFixed(4) : '—'} />
            <DetailKV k="bytes" v={`${stats.bytes.toLocaleString()} B`} />
            <DetailKV k="bitrate" v={stats.audio_s > 0 ? `${(stats.bytes * 8 / 1000 / stats.audio_s).toFixed(1)} kbps` : '—'} />
          </div>
        )}
      </div>

      <audio
        ref={audioRef}
        src={url ?? undefined}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => setT(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => {
          const d = audioRef.current?.duration ?? 0;
          setDuration(isFinite(d) ? d : 0);
        }}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />
    </section>
  );
}

function fmtRtf(rtf: number): string {
  if (!isFinite(rtf) || rtf <= 0) return '—';
  return `${rtf.toFixed(2)}×`;
}

function PerfBlock({ value, label, primary }: { value: string; label?: string; primary?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={primary ? 'phos-text font-semibold text-[12px]' : 'text-[var(--color-fg)]'}>
        {value}
      </span>
      {label && <span className="text-[var(--color-fg-4)] tracking-[0.04em]">{label}</span>}
    </span>
  );
}

function Sep() {
  return <span className="text-[var(--color-border-strong)] mx-3">·</span>;
}

function DetailKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-4)]">{k}</span>
      <span className="text-[var(--color-fg-2)]">{v}</span>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M6 1V8M3 6L6 9L9 6M2 11h8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
