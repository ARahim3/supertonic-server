export type Format = 'mp3' | 'wav' | 'pcm';

export type Health = {
  status: string;
  version: string;
  model: string;
  sample_rate: number;
  voices: string[];
  languages: string[];
  device_request: string;
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
