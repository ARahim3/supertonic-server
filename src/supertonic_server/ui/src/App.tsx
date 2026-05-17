import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Format, Health, SpeechParams, SynthesisStats, VoicesResp } from './types';
import { decodeAudio, getHealth, getMetricsSummary, getVoices, synthesize, toPlayableBlob } from './api';
import { TopBar } from './components/TopBar';
import { Editor } from './components/Editor';
import { Player } from './components/Player';
import { CodeSnippet } from './components/CodeSnippet';
import { NavTabs, type ViewKey } from './components/NavTabs';
import { Observatory } from './components/Observatory';

const DEFAULT_TEXT =
  'Hello, world. Supertonic is now running locally on your machine.';

export default function App() {
  /* ------------------- theme ------------------- */
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('supertonic-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return 'dark';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('supertonic-theme', theme);
  }, [theme]);

  /* ------------------- view (console / observatory) ------------------- */
  const [view, setView] = useState<ViewKey>(() => {
    const saved = localStorage.getItem('supertonic-view');
    return saved === 'observatory' ? 'observatory' : 'console';
  });
  useEffect(() => {
    localStorage.setItem('supertonic-view', view);
  }, [view]);

  /* ------------------- lightweight active-count poll for the nav badge -- */
  const [activeCount, setActiveCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const s = await getMetricsSummary(ctrl.signal);
        if (!cancelled) setActiveCount(s.active);
      } catch {
        /* ignore — handled in Observatory view */
      }
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      ctrl.abort();
      window.clearInterval(id);
    };
  }, []);

  /* ------------------- server state ------------------- */
  const [health, setHealth] = useState<Health | null>(null);
  const [voices, setVoices] = useState<VoicesResp | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, v] = await Promise.all([getHealth(), getVoices()]);
        if (cancelled) return;
        setHealth(h);
        setVoices(v);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoadingHealth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------- form state ------------------- */
  const [text, setText] = useState(DEFAULT_TEXT);
  const [voice, setVoice] = useState('alloy');
  const [lang, setLang] = useState('en');
  const [speed, setSpeed] = useState(1.05);
  const [steps, setSteps] = useState(8);
  const [format, setFormat] = useState<Format>('mp3');

  const params: SpeechParams = useMemo(
    () => ({ text, voice, lang, speed, total_steps: steps, format }),
    [text, voice, lang, speed, steps, format]
  );

  /* ------------------- synthesis state ------------------- */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [stats, setStats] = useState<SynthesisStats | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);
  const [liveTtfb, setLiveTtfb] = useState<number | null>(null);
  const [liveBytes, setLiveBytes] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onSynth = useCallback(async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setLiveTtfb(null);
    setLiveBytes(null);
    setPeaks([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const { blob: rawBlob, stats } = await synthesize(params, {
        signal: ctrl.signal,
        onTTFB: (ms) => setLiveTtfb(ms),
        onProgress: (bytes) => setLiveBytes(bytes),
      });
      // Normalize for browser playback: wrap PCM in a WAV header, repair
      // the streaming WAV header. Without this, <audio> mishandles them.
      const sr = health?.sample_rate ?? 44100;
      const playable = await toPlayableBlob(rawBlob, format, sr);
      setBlob(playable);
      setStats(stats);

      if (format !== 'pcm') {
        // Decode for the waveform AND grab the true duration. For MP3 the
        // server can't derive audio_s from byte count, so we patch the stats
        // with the decoded duration → RTF becomes meaningful instead of "—".
        const { peaks, duration } = await decodeAudio(playable, 240);
        setPeaks(peaks);
        if (duration > 0) {
          setStats({
            ...stats,
            audio_s: duration,
            rtf: stats.total_ms / 1000 / duration,
          });
        }
      } else {
        // PCM: stats already have a correct audio_s from byte count. Just
        // build peaks directly from the int16 buffer (cheaper than AudioContext).
        const buf = await rawBlob.arrayBuffer();
        const view = new Int16Array(buf);
        const buckets = 240;
        const step = Math.max(1, Math.floor(view.length / buckets));
        const out: number[] = [];
        for (let i = 0; i < buckets; i++) {
          let m = 0;
          const s = i * step;
          const e = Math.min(s + step, view.length);
          for (let k = s; k < e; k++) {
            const v = Math.abs(view[k]) / 32768;
            if (v > m) m = v;
          }
          out.push(m);
        }
        setPeaks(out);
      }
    } catch (e: unknown) {
      const ae = e as { name?: string; message?: string };
      if (ae?.name !== 'AbortError') {
        setError(ae?.message ?? String(e));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }, [text, busy, params, format, health]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /* ------------------- ⌘ + ⏎ to synthesize ------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        onSynth();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onSynth]);

  const filename = `supertonic-${voice}-${Date.now()}.${format}`;

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar
        health={health}
        loadingHealth={loadingHealth}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <NavTabs view={view} onChange={setView} active={activeCount} />

      <main className="flex-1 mx-auto w-full max-w-[1320px] px-8 py-7 space-y-7">
        {view === 'console' ? (
          <>
            {/* HERO: input → output, output gets slightly more room */}
            <div className="grid grid-cols-12 gap-7">
              <div className="col-span-12 lg:col-span-6">
                <Editor
                  voices={voices}
                  languages={health?.languages ?? []}
                  text={text}
                  voice={voice}
                  lang={lang}
                  speed={speed}
                  steps={steps}
                  format={format}
                  onText={setText}
                  onVoice={setVoice}
                  onLang={setLang}
                  onSpeed={setSpeed}
                  onSteps={setSteps}
                  onFormat={setFormat}
                  busy={busy}
                  error={error}
                  onSynth={onSynth}
                  onCancel={onCancel}
                  liveTtfbMs={liveTtfb}
                  liveBytes={liveBytes}
                />
              </div>

              <div className="col-span-12 lg:col-span-6">
                <Player
                  blob={blob}
                  stats={stats}
                  peaks={peaks}
                  busy={busy}
                  filename={filename}
                />
              </div>
            </div>

            {/* CODE — recessed, opens on demand */}
            <CodeSnippet params={params} />
          </>
        ) : (
          <Observatory />
        )}

        <Footer />
      </main>
    </div>
  );
}

function Footer() {
  return (
    <footer className="pt-4 pb-2 flex items-center justify-between gap-4 border-t border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        <Wave />
        <span className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-fg-3)]">
          supertonic·server · <span className="phos-text">private · on-device</span>
        </span>
      </div>
      <div className="flex items-center gap-4 text-[10px] tracking-[0.08em] text-[var(--color-fg-4)]">
        <a href="https://github.com/ARahim3/supertonic-server" target="_blank" rel="noreferrer" className="hover:text-[var(--color-fg-2)] transition-colors">
          GitHub ↗
        </a>
        <a href="https://huggingface.co/Supertone/supertonic-3" target="_blank" rel="noreferrer" className="hover:text-[var(--color-fg-2)] transition-colors">
          Model ↗
        </a>
        <a href="https://github.com/supertone-inc/supertonic" target="_blank" rel="noreferrer" className="hover:text-[var(--color-fg-2)] transition-colors">
          Upstream ↗
        </a>
      </div>
    </footer>
  );
}

function Wave() {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden>
      <path
        d="M1 7 Q 4 1 7 7 T 13 7 T 19 7 L 21 7"
        stroke="var(--color-phos-dim)"
        strokeWidth="1.2"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
