import type { SpeechParams } from '../types';

const escJSON = (s: string) =>
  JSON.stringify(s).slice(1, -1); // strip outer quotes

const sample = (text: string) => (text.trim() ? text : 'Hello, world.');

/* ------------------------------------------------------------------ */
/*  Each language returns a {code, lang} pair so we can syntax-color.  */
/* ------------------------------------------------------------------ */

export type SnippetLang = 'curl' | 'python' | 'httpx' | 'pipecat' | 'livekit' | 'js';

export const SNIPPETS: { id: SnippetLang; label: string; lang: 'bash' | 'python' | 'js' }[] = [
  { id: 'curl',    label: 'curl',            lang: 'bash' },
  { id: 'python',  label: 'Python · OpenAI', lang: 'python' },
  { id: 'httpx',   label: 'Python · httpx',  lang: 'python' },
  { id: 'pipecat', label: 'Pipecat',         lang: 'python' },
  { id: 'livekit', label: 'LiveKit',         lang: 'python' },
  { id: 'js',      label: 'JavaScript',      lang: 'js' },
];

export function makeSnippet(id: SnippetLang, p: SpeechParams, origin = 'http://localhost:8000'): string {
  const text = sample(p.text);

  switch (id) {
    case 'curl':
      return `curl -X POST ${origin}/v1/audio/speech \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify({
    model: 'supertonic-3',
    input: text,
    voice: p.voice,
    lang: p.lang,
    response_format: p.format,
    speed: p.speed,
    total_steps: p.total_steps,
  })}' \\
  --output out.${p.format}`;

    case 'python':
      return `from openai import OpenAI

client = OpenAI(base_url="${origin}/v1", api_key="not-needed")
audio = client.audio.speech.create(
    model="supertonic-3",
    voice="${p.voice}",
    input="${escJSON(text)}",
    response_format="${p.format}",
    speed=${p.speed},
)
audio.stream_to_file("out.${p.format}")`;

    case 'httpx':
      return `import httpx

payload = {
    "model": "supertonic-3",
    "input": "${escJSON(text)}",
    "voice": "${p.voice}",
    "lang": "${p.lang}",
    "response_format": "${p.format}",
    "speed": ${p.speed},
    "total_steps": ${p.total_steps},
}

with httpx.stream("POST", "${origin}/v1/audio/speech", json=payload) as r:
    with open("out.${p.format}", "wb") as f:
        for chunk in r.iter_bytes():
            f.write(chunk)`;

    case 'pipecat':
      return `from pipecat.services.openai.tts import OpenAITTSService, OpenAITTSSettings

tts = OpenAITTSService(
    api_key="not-needed",
    base_url="${origin}/v1",
    settings=OpenAITTSSettings(
        model="supertonic-3",
        voice="${p.voice}",
    ),
    sample_rate=44100,  # supertonic-3 native rate
)
# Plug into any Pipecat pipeline as the TTS service.`;

    case 'livekit':
      return `from livekit.plugins import openai

tts = openai.TTS(
    base_url="${origin}/v1",
    api_key="not-needed",
    model="supertonic-3",
    voice="${p.voice}",
)`;

    case 'js':
      return `const r = await fetch("${origin}/v1/audio/speech", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "supertonic-3",
    input: "${escJSON(text)}",
    voice: "${p.voice}",
    lang: "${p.lang}",
    response_format: "${p.format}",
    speed: ${p.speed},
    total_steps: ${p.total_steps},
  }),
});
const blob = await r.blob();
new Audio(URL.createObjectURL(blob)).play();`;
  }
}

/* ------------------------------------------------------------------ */
/*  Lightweight regex-based highlighter — no Prism dependency.         */
/* ------------------------------------------------------------------ */

const KW_BASH   = /\b(curl|GET|POST|PUT|DELETE)\b/g;
const KW_PYTHON = /\b(from|import|with|as|for|in|return|def|class|None|True|False)\b/g;
const KW_JS     = /\b(const|let|var|function|return|await|async|new|import|from|export|true|false|null|undefined)\b/g;
// Combined string regex — leftmost opening quote wins, so curl's
// `'{"key":"val"}'` is captured as ONE string instead of splitting on
// the inner doubles.
const STR_ANY = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g;
const NUM     = /\b\d+(\.\d+)?\b/g;
const COMMENT_PY_BASH = /(^|\s)(#[^\n]*)/g;
const COMMENT_JS      = /\/\/[^\n]*/g;

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Word-char-only placeholders. The digits sit between `\w` chars on both
// sides, so the number regex (`\b\d+\b`) can't match them mid-restoration.
// Two distinct placeholder shapes so strings and comments don't collide.
const PH_STR_RE = /__SSTOK(\d+)KOTSS__/g;
const phStr = (i: number) => `__SSTOK${i}KOTSS__`;
const PH_CMT_RE = /__CCTOK(\d+)KOTCC__/g;
const phCmt = (i: number) => `__CCTOK${i}KOTCC__`;

export function highlight(code: string, lang: 'bash' | 'python' | 'js'): string {
  let out = escapeHtml(code);

  // 1) hide strings behind placeholders. Their contents must not be tokenized.
  const stringTokens: string[] = [];
  out = out.replace(STR_ANY, (m) => {
    stringTokens.push(`<span class="str">${m}</span>`);
    return phStr(stringTokens.length - 1);
  });

  // 2) hide comments behind placeholders TOO — otherwise the keyword pass below
  //    matches words like `class` (a Python keyword) inside our injected
  //    `<span class="cmt">` attribute name and emits malformed HTML
  //    (`<span <span class="kw">class</span>="cmt">`) that browsers render as
  //    literal text. The fix is to keep the keyword/number passes from ever
  //    seeing our own injected attributes.
  const commentTokens: string[] = [];
  const stashCmt = (m: string) => {
    commentTokens.push(`<span class="cmt">${m}</span>`);
    return phCmt(commentTokens.length - 1);
  };
  if (lang === 'bash' || lang === 'python') {
    out = out.replace(COMMENT_PY_BASH, (_full, pre: string, cmt: string) => pre + stashCmt(cmt));
  }
  if (lang === 'js') {
    out = out.replace(COMMENT_JS, (m) => stashCmt(m));
  }

  // 3) keywords — now operates on code with no exposed injected attributes
  if (lang === 'bash')   out = out.replace(KW_BASH,   (m) => `<span class="kw">${m}</span>`);
  if (lang === 'python') out = out.replace(KW_PYTHON, (m) => `<span class="kw">${m}</span>`);
  if (lang === 'js')     out = out.replace(KW_JS,     (m) => `<span class="kw">${m}</span>`);

  // 4) numbers — placeholder format keeps token digits safe from this pass
  out = out.replace(NUM, (m) => `<span class="num">${m}</span>`);

  // 5) restore comments FIRST (the injected span may itself contain a string
  //    placeholder, e.g. `# the URL "http://..." is special`), then strings.
  out = out.replace(PH_CMT_RE, (_, i) => commentTokens[parseInt(i, 10)]);
  out = out.replace(PH_STR_RE, (_, i) => stringTokens[parseInt(i, 10)]);

  return out;
}
