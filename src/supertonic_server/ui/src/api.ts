import type { Format, Health, SpeechParams, SynthesisStats, VoicesResp } from './types';

const j = (r: Response) => {
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
};

export const getHealth = (): Promise<Health> => fetch('/healthz').then(j);
export const getVoices = (): Promise<VoicesResp> => fetch('/v1/voices').then(j);

export type SynthOptions = {
  onTTFB?: (ms: number) => void;
  onProgress?: (bytes: number, elapsedMs: number) => void;
  signal?: AbortSignal;
};

/**
 * Stream PCM/WAV/MP3 bytes from the server and return the assembled Blob
 * plus timing stats. The onProgress callback fires for every received chunk.
 */
export async function synthesize(
  params: SpeechParams,
  opts: SynthOptions = {}
): Promise<{ blob: Blob; stats: SynthesisStats; contentType: string }> {
  const t0 = performance.now();

  const r = await fetch('/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'supertonic-3',
      input: params.text,
      voice: params.voice,
      lang: params.lang,
      response_format: params.format,
      speed: params.speed,
      total_steps: params.total_steps,
    }),
    signal: opts.signal,
  });

  if (!r.ok) {
    let detail: string;
    try {
      const j = await r.json();
      detail = JSON.stringify(j);
    } catch {
      detail = r.statusText;
    }
    throw new Error(`${r.status}: ${detail}`);
  }

  const contentType = r.headers.get('content-type') || `audio/${params.format}`;
  const sampleRate = parseInt(r.headers.get('x-sample-rate') ?? '44100', 10);
  const reader = r.body!.getReader();

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let ttfbMs = 0;
  let firstByte = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!firstByte) {
      firstByte = true;
      ttfbMs = performance.now() - t0;
      opts.onTTFB?.(ttfbMs);
    }
    chunks.push(value);
    bytes += value.byteLength;
    opts.onProgress?.(bytes, performance.now() - t0);
  }

  const totalMs = performance.now() - t0;
  const blob = new Blob(chunks as BlobPart[], { type: contentType });

  // audio duration estimate
  let audioS = 0;
  if (params.format === 'pcm') {
    // raw int16 mono
    audioS = bytes / 2 / sampleRate;
  } else if (params.format === 'wav') {
    // 44-byte streaming header
    audioS = Math.max(0, (bytes - 44)) / 2 / sampleRate;
  } else {
    // mp3 — decode in caller via AudioContext if needed; estimate 0 here
    audioS = 0;
  }

  const stats: SynthesisStats = {
    ttfb_ms: ttfbMs,
    total_ms: totalMs,
    audio_s: audioS,
    rtf: audioS > 0 ? totalMs / 1000 / audioS : 0,
    bytes,
  };

  return { blob, stats, contentType };
}

/**
 * Wrap PCM in a proper WAV container, or repair a streaming-WAV header so the
 * `<audio>` element can play it reliably.
 *
 *   pcm  → prepend a 44-byte RIFF/WAVE header sized to the actual data
 *   wav  → rewrite the header's RIFF and data sizes to match the actual bytes
 *          (server emits a fake-large size so the file streams; browsers want
 *          the real one for playback)
 *   mp3  → passthrough (browsers decode it natively)
 *
 * This is needed because <audio> won't play `audio/L16` and some browsers
 * mishandle WAV headers that lie about their length.
 */
export async function toPlayableBlob(
  raw: Blob,
  format: Format,
  sampleRate: number,
  channels = 1,
  bits = 16,
): Promise<Blob> {
  if (format === 'mp3') return raw;

  if (format === 'pcm') {
    const pcm = new Uint8Array(await raw.arrayBuffer());
    const header = buildWavHeader(pcm.byteLength, sampleRate, channels, bits);
    return new Blob([header as BlobPart, pcm as BlobPart], { type: 'audio/wav' });
  }

  // wav: keep the bytes but rewrite the size fields.
  const buf = new Uint8Array(await raw.arrayBuffer());
  if (buf.byteLength < 44) return raw; // malformed; let the browser try
  const dataSize = Math.max(0, buf.byteLength - 44);
  const out = new Uint8Array(buf); // copy so we don't mutate the source
  const dv = new DataView(out.buffer);
  dv.setUint32(4, dataSize + 36, true);  // RIFF chunk size
  dv.setUint32(40, dataSize, true);      // data chunk size
  return new Blob([out as BlobPart], { type: 'audio/wav' });
}

function buildWavHeader(dataSize: number, sampleRate: number, channels: number, bits: number): Uint8Array {
  const byteRate = (sampleRate * channels * bits) / 8;
  const blockAlign = (channels * bits) / 8;
  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  dv.setUint32(4, dataSize + 36, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);            // PCM format
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bits, true);
  w(36, 'data');
  dv.setUint32(40, dataSize, true);
  return new Uint8Array(header);
}

/**
 * Decode an audio Blob into:
 *   - per-bucket peaks for the waveform display
 *   - the true audio duration in seconds (free byproduct of the decode)
 *
 * The duration is what we use to fix MP3 RTF — for compressed formats the
 * server can't compute audio_s from byte count alone, so we get it here.
 */
export async function decodeAudio(blob: Blob, buckets = 240): Promise<{ peaks: number[]; duration: number }> {
  try {
    const ab = await blob.arrayBuffer();
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const audio = await ctx.decodeAudioData(ab.slice(0));
    const ch = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / buckets));
    const peaks: number[] = [];
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * step;
      const end = Math.min(start + step, ch.length);
      for (let k = start; k < end; k++) {
        const v = Math.abs(ch[k]);
        if (v > max) max = v;
      }
      peaks.push(max);
    }
    const duration = audio.duration;
    ctx.close();
    return { peaks, duration };
  } catch {
    return { peaks: [], duration: 0 };
  }
}

/** Back-compat alias (older callers that only wanted peaks). */
export async function decodePeaks(blob: Blob, buckets = 240): Promise<number[]> {
  const { peaks } = await decodeAudio(blob, buckets);
  return peaks;
}
