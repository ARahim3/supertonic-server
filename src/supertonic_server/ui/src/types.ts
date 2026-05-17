export type Format = 'mp3' | 'wav' | 'pcm';

export type Health = {
  status: string;
  version: string;
  model: string;
  sample_rate: number;
  voices: string[];
  languages: string[];
  device_request: string;
  ws_enabled?: boolean;
};

export type VoiceEntry = { id: string; supertonic_voice: string };
export type VoicesResp = {
  object: 'list';
  supertonic_voices: string[];
  openai_aliases: Record<string, string>;
  data: VoiceEntry[];
};

export type SpeechParams = {
  text: string;
  voice: string;
  lang: string;
  speed: number;
  total_steps: number;
  format: Format;
};

export type SynthesisStats = {
  ttfb_ms: number;
  total_ms: number;
  audio_s: number;
  rtf: number;
  bytes: number;
};

/* ---- Observability ---- */

export type Percentiles = {
  p50: number;
  p95: number;
  p99: number;
  count: number;
};

export type MetricsSummary = {
  uptime_s: number;
  active: number;
  totals: {
    requests: number;
    ok: number;
    error: number;
    cancelled: number;
    bytes: number;
    audio_s: number;
  };
  window: {
    buffer_capacity: number;
    buffer_used: number;
    rps_1m: number;
    rps_5m: number;
    error_rate: number;
    ttfb_ms: Percentiles;
    rtf: Percentiles;
  };
};

export type RecentRecord = {
  id: number;
  started_at: number;
  ended_at: number;
  text_snippet: string;
  text_length: number;
  voice: string;
  lang: string;
  format: string;
  status: 'ok' | 'cancelled' | 'error';
  ttfb_ms: number;
  total_ms: number;
  bytes: number;
  audio_s: number;
  rtf: number;
  error: string | null;
  transport: 'http' | 'ws';
};
