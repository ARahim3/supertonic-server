import { useEffect, useState } from 'react';
import type { Format, VoicesResp } from '../types';
import { ParamRow } from './ParamRow';

type Props = {
  voices: VoicesResp | null;
  languages: string[];

  text: string;
  voice: string;
  lang: string;
  speed: number;
  steps: number;
  format: Format;

  onText: (s: string) => void;
  onVoice: (v: string) => void;
  onLang: (v: string) => void;
  onSpeed: (n: number) => void;
  onSteps: (n: number) => void;
  onFormat: (f: Format) => void;

  busy: boolean;
  error: string | null;
  onSynth: () => void;
  onCancel: () => void;
  liveTtfbMs: number | null;
  liveBytes: number | null;
};

const MAX = 20000;

const SAMPLES: { label: string; text: string }[] = [
  { label: 'en greeting',     text: 'Hello, world. Supertonic is now running locally on your machine.' },
  { label: 'pangram + breath', text: 'The quick brown fox jumps over the lazy dog. <breath> Five wizards quickly hex a jumpy ogre.' },
  { label: 'korean',           text: '안녕하세요. 오늘 하루도 좋은 하루 보내세요.' },
  { label: 'japanese',         text: 'こんにちは。今日はいい天気ですね。' },
];

export function Editor(p: Props) {
  const count = p.text.length;
  const overflow = count > MAX;

  return (
    <section className="flex flex-col gap-3 rise d1">
      {/* numbered header — "01 · INPUT" */}
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] tracking-[0.22em] uppercase font-semibold text-[var(--color-fg-2)]">
          <span className="text-[var(--color-fg-4)]">01 · </span>INPUT
        </span>
        <span className={'text-[10px] tracking-[0.06em] tabular-nums ' + (overflow ? 'text-[var(--color-red)]' : 'text-[var(--color-fg-3)]')}>
          {count.toLocaleString()}<span className="text-[var(--color-fg-4)]"> / {MAX.toLocaleString()}</span>
        </span>
      </div>

      <textarea
        className="console-textarea"
        placeholder="Type or paste text to synthesize…"
        value={p.text}
        onChange={(e) => p.onText(e.target.value)}
        spellCheck={false}
        rows={5}
        maxLength={MAX}
      />

      {/* try-samples row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[9px] text-[var(--color-fg-4)] tracking-[0.14em] uppercase mr-1">
          try
        </span>
        {SAMPLES.map((s) => (
          <button
            key={s.label}
            onClick={() => p.onText(s.text)}
            className="text-[10px] text-[var(--color-fg-3)] hover:text-[var(--color-fg)] border border-[var(--color-border)] hover:border-[var(--color-border-strong)] px-2 py-0.5 tracking-[0.04em] transition-colors"
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* params — 5 inline cells */}
      <ParamRow
        voices={p.voices}
        languages={p.languages}
        voice={p.voice}
        lang={p.lang}
        speed={p.speed}
        steps={p.steps}
        format={p.format}
        onVoice={p.onVoice}
        onLang={p.onLang}
        onSpeed={p.onSpeed}
        onSteps={p.onSteps}
        onFormat={p.onFormat}
      />

      {/* primary action */}
      <div className="flex items-center justify-between gap-3 pt-1">
        {p.busy ? (
          <BusyButton onCancel={p.onCancel} ttfb={p.liveTtfbMs} bytes={p.liveBytes} />
        ) : (
          <button
            onClick={p.onSynth}
            disabled={!p.text.trim() || overflow}
            className="btn-primary flex-1"
          >
            <PlayIcon />
            Synthesize
            <span className="ml-auto text-[10px] tracking-[0.1em] font-medium opacity-60">⌘ ⏎</span>
          </button>
        )}
      </div>

      {p.error && (
        <span className="text-[11px] text-[var(--color-red)] tracking-[0.04em] truncate">
          ⚠ {p.error}
        </span>
      )}
    </section>
  );
}

function BusyButton({
  onCancel,
  ttfb,
  bytes,
}: {
  onCancel: () => void;
  ttfb: number | null;
  bytes: number | null;
}) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = window.setInterval(() => setElapsed(performance.now() - start), 33);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-4 flex-1">
      <button onClick={onCancel} className="btn-primary busy">
        <SquareIcon />
        Cancel
      </button>
      <div className="flex items-center gap-4 text-[11px] text-[var(--color-fg-3)] tracking-[0.06em] tabular-nums">
        <span>
          <span className="text-[var(--color-fg-4)]">elapsed </span>
          <span className="phos-text">{(elapsed / 1000).toFixed(2)}s</span>
        </span>
        {ttfb !== null && (
          <span>
            <span className="text-[var(--color-fg-4)]">ttfb </span>
            <span className="phos-text">{ttfb.toFixed(0)}ms</span>
          </span>
        )}
        {bytes !== null && (
          <span>
            <span className="text-[var(--color-fg-4)]">recv </span>
            <span className="phos-text">{(bytes / 1024).toFixed(1)}kb</span>
          </span>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d="M3 2L10 6L3 10Z" fill="currentColor" />
    </svg>
  );
}

function SquareIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1" y="1" width="8" height="8" fill="currentColor" />
    </svg>
  );
}
