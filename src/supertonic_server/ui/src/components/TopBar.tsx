import type { Health } from '../types';

type Props = {
  health: Health | null;
  loadingHealth: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
};

export function TopBar({ health, loadingHealth, theme, onToggleTheme }: Props) {
  const status: 'ready' | 'loading' | 'error' =
    loadingHealth ? 'loading' : health ? 'ready' : 'error';

  const ledClass = status === 'ready' ? '' : status === 'loading' ? 'amber' : 'red';
  const statusLabel = status === 'ready' ? 'ready' : status === 'loading' ? 'loading' : 'offline';

  return (
    <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="mx-auto max-w-[1280px] px-8 h-[44px] flex items-center justify-between gap-6">
        {/* brand — name + tiny subtitle, no separate chips */}
        <div className="flex items-baseline gap-3">
          <Logo />
          <span className="text-[12px] font-bold tracking-[0.18em] ml-1">SUPERTONIC</span>
          <span className="text-[10px] text-[var(--color-fg-3)] tracking-[0.04em]">
            tts · localhost
          </span>
        </div>

        {/* status — single inline cluster instead of 5 chips */}
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 text-[10.5px] uppercase tracking-[0.1em]">
            <span className={`led ${ledClass}`} />
            <span className="text-[var(--color-fg-2)]">{statusLabel}</span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className="text-[var(--color-fg-3)] numb">{health?.device_request ?? '—'}</span>
            <span className="text-[var(--color-border-strong)]">·</span>
            <span className="text-[var(--color-fg-3)] numb">
              {health ? (health.sample_rate / 1000).toFixed(1) + 'k' : '—'}
            </span>
          </span>

          <button
            onClick={onToggleTheme}
            className="opacity-60 hover:opacity-100 transition-opacity p-1"
            title={`switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            aria-label="toggle theme"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <span className="text-[10px] text-[var(--color-fg-4)] tracking-[0.12em] tabular-nums">
            v{health?.version ?? '0.2.0'}
          </span>
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="2" stroke="currentColor" opacity="0.25" />
      <path
        d="M3 12 Q 6 5 9 12 T 15 12 T 21 12"
        stroke="var(--color-phos)"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a8.5 8.5 0 1 0 11.5 11.5z" />
    </svg>
  );
}
