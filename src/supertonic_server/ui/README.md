# supertonic-server / web UI

Single-page React app served by the FastAPI server at `/`. Built with Vite +
TypeScript + Tailwind CSS v4 + JetBrains Mono. Zero runtime dependencies on
external CDNs — fonts are bundled via `@fontsource-variable/jetbrains-mono`.

## Dev

```bash
cd src/supertonic_server/ui
npm install
npm run dev         # http://localhost:5173 with hot reload — API requests proxy to :8000
```

You need the Python server running on `http://localhost:8000` for API calls to
work. In another shell:

```bash
supertonic-server --port 8000
```

## Build

```bash
npm run build       # writes static SPA to ./dist/
```

The `dist/` directory is committed into the Python package and shipped inside
the wheel. **Re-run `npm run build` and commit `dist/` whenever you change
the UI source.** FastAPI mounts `dist/assets` under `/static/` and serves
`dist/index.html` at `/`. Vite is configured with `base: '/static/'` so the
built index references its JS/CSS correctly.

## Structure

```
src/
├── main.tsx                  React entry
├── App.tsx                   top-level state + layout
├── styles.css                Tailwind v4 theme + custom utilities
├── types.ts
├── api.ts                    fetch helpers for /healthz, /v1/voices, /v1/audio/speech
├── lib/
│   ├── langs.ts              ISO-639-1 → display name
│   └── snippets.ts           code-snippet generators (curl, OpenAI, httpx, Pipecat, LiveKit, JS)
└── components/
    ├── TopBar.tsx
    ├── Controls.tsx
    ├── Editor.tsx
    ├── Slider.tsx
    ├── Player.tsx
    ├── Waveform.tsx
    └── CodeSnippet.tsx
```

## Design

"Instrument console" — JetBrains Mono everywhere, dark slate base, phosphor
green accent. Sharp corners, tick-marked sliders, LED status with halo,
subtle CRT scan-lines on the backdrop. Both dark and light themes (toggle in
top bar; preference persists in `localStorage`).
