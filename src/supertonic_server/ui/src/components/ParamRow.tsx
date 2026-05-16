import type { Format, VoicesResp } from '../types';
import { LANG_NAMES } from '../lib/langs';

type Props = {
  voices: VoicesResp | null;
  languages: string[];
  voice: string;
  lang: string;
  speed: number;
  steps: number;
  format: Format;
  onVoice: (v: string) => void;
  onLang: (v: string) => void;
  onSpeed: (n: number) => void;
  onSteps: (n: number) => void;
  onFormat: (f: Format) => void;
};

const FORMATS: Format[] = ['mp3', 'wav', 'pcm'];

/**
 * Five inline parameter cells — voice / lang / speed / steps / format —
 * in one horizontal grid. Replaces the previous standalone Controls panel
 * so the input section reads in a single beat.
 */
export function ParamRow(p: Props) {
  const aliasEntries = p.voices ? Object.entries(p.voices.openai_aliases) : [];
  const nativeIds = p.voices?.supertonic_voices ?? [];
  const resolvedFor = (id: string) =>
    p.voices?.data.find((d) => d.id === id)?.supertonic_voice ?? id;

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      {/* VOICE */}
      <Cell label="voice">
        <select
          className="param-select"
          value={p.voice}
          onChange={(e) => p.onVoice(e.target.value)}
          disabled={!p.voices}
        >
          {aliasEntries.length > 0 && (
            <optgroup label="OpenAI aliases">
              {aliasEntries.map(([id, st]) => (
                <option key={id} value={id}>
                  {id} → {st}
                </option>
              ))}
            </optgroup>
          )}
          {nativeIds.length > 0 && (
            <optgroup label="Supertonic native">
              {nativeIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <div className="param-resolved">→ {resolvedFor(p.voice)}</div>
      </Cell>

      {/* LANG */}
      <Cell label="lang">
        <select
          className="param-select"
          value={p.lang}
          onChange={(e) => p.onLang(e.target.value)}
          disabled={p.languages.length === 0}
        >
          {p.languages.map((code) => (
            <option key={code} value={code}>
              {LANG_NAMES[code] ?? code}
            </option>
          ))}
        </select>
        <div className="param-resolved numb">{p.lang.toUpperCase()}</div>
      </Cell>

      {/* SPEED */}
      <SliderCell
        label="speed"
        value={p.speed}
        min={0.5}
        max={2.0}
        step={0.05}
        format={(n) => `${n.toFixed(2)}×`}
        onChange={p.onSpeed}
      />

      {/* STEPS */}
      <SliderCell
        label="diffusion steps"
        value={p.steps}
        min={4}
        max={16}
        step={1}
        format={(n) => `${n}`}
        onChange={p.onSteps}
      />

      {/* FORMAT */}
      <Cell label="format" noBorderRight>
        <div className="flex items-stretch border border-[var(--color-border-2)] mt-1">
          {FORMATS.map((f) => (
            <button
              key={f}
              onClick={() => p.onFormat(f)}
              className={
                'flex-1 py-1.5 text-[10.5px] tracking-[0.14em] uppercase transition-colors border-r border-[var(--color-border-2)] last:border-r-0 ' +
                (p.format === f
                  ? 'bg-[var(--color-phos-bg)] phos-text'
                  : 'text-[var(--color-fg-3)] hover:text-[var(--color-fg)]')
              }
            >
              {f}
            </button>
          ))}
        </div>
      </Cell>
    </div>
  );
}

function Cell({
  label,
  children,
  noBorderRight,
}: {
  label: string;
  children: React.ReactNode;
  noBorderRight?: boolean;
}) {
  return (
    <div
      className={
        'p-3 flex flex-col gap-1.5 min-h-[68px] ' +
        (noBorderRight ? '' : 'md:border-r border-[var(--color-border)]')
      }
    >
      <div className="text-[9px] tracking-[0.14em] uppercase text-[var(--color-fg-3)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function SliderCell({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <Cell label={label}>
      <div className="flex items-baseline justify-between">
        <span className="numb text-[13px] phos-text">{format(value)}</span>
      </div>
      <input
        type="range"
        className="fader mini-fader"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%` }}
      />
    </Cell>
  );
}
