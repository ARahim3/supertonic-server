import { useMemo, useState } from 'react';
import type { SpeechParams } from '../types';
import { SNIPPETS, type SnippetLang, highlight, makeSnippet } from '../lib/snippets';

type Props = {
  params: SpeechParams;
  origin?: string;
};

export function CodeSnippet({ params, origin }: Props) {
  const [tab, setTab] = useState<SnippetLang>('curl');
  const [copied, setCopied] = useState(false);

  const meta = useMemo(() => SNIPPETS.find((s) => s.id === tab)!, [tab]);
  const code = useMemo(
    () => makeSnippet(tab, params, origin ?? window.location.origin),
    [tab, params, origin]
  );
  const html = useMemo(() => highlight(code, meta.lang), [code, meta.lang]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {}
  };

  return (
    <section className="panel rise d4">
      <div className="panel-h">
        <span className="label">use from your code</span>
        <span className="text-[10px] text-[var(--color-fg-4)] tracking-[0.08em]">live · reflects current settings</span>
      </div>

      <div className="flex items-center gap-0 border-b border-[var(--color-border)] overflow-x-auto">
        {SNIPPETS.map((s) => (
          <button
            key={s.id}
            onClick={() => setTab(s.id)}
            className={'tab ' + (tab === s.id ? 'active' : '')}
          >
            {s.label}
          </button>
        ))}
        <div className="ml-auto pr-3">
          <button
            onClick={copy}
            className="btn-ghost !text-[10px] !py-1.5"
            title="copy to clipboard"
          >
            {copied ? (
              <>
                <CheckIcon /> Copied
              </>
            ) : (
              <>
                <ClipIcon /> Copy
              </>
            )}
          </button>
        </div>
      </div>

      <div className="p-5">
        <pre className="code-block">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </div>
    </section>
  );
}

function ClipIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      <rect x="3" y="2.5" width="6" height="7.5" />
      <path d="M4.5 2.5V1.5h3v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M2 6.5l2.5 2.5L10 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
