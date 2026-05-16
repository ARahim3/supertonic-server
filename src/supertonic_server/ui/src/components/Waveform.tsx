import { useEffect, useRef } from 'react';

type Props = {
  peaks: number[];
  progress: number; // 0..1
  busy: boolean;
  height?: number;
};

/** Canvas waveform with phosphor-green progress overlay. */
export function Waveform({ peaks, progress, busy, height = 88 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-fg-4').trim() || '#454d4a';
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--color-phos').trim() || '#6ee066';
    const gridFg = getComputedStyle(document.documentElement).getPropertyValue('--color-border').trim() || '#232b29';

    // baseline grid line
    ctx.strokeStyle = gridFg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    if (busy && peaks.length === 0) {
      // pulsing skeleton bars while we wait
      const t = (Date.now() / 1000) % 1;
      const barW = 3;
      const gap = 2;
      const n = Math.floor(w / (barW + gap));
      ctx.fillStyle = bg;
      for (let i = 0; i < n; i++) {
        const phase = (i / n + t) % 1;
        const m = 0.18 + 0.55 * Math.abs(Math.sin(phase * Math.PI * 3));
        const bh = m * (h - 8);
        ctx.fillRect(i * (barW + gap), (h - bh) / 2, barW, bh);
      }
      const id = requestAnimationFrame(() => {
        // force re-render via state? we just redraw on next effect tick using key
      });
      return () => cancelAnimationFrame(id);
    }

    if (peaks.length === 0) {
      // empty state: faint sine ghost
      ctx.strokeStyle = bg;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const amp = h / 3;
      for (let x = 0; x <= w; x++) {
        const y = h / 2 + Math.sin((x / w) * Math.PI * 4) * amp * 0.18;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    const playedX = Math.floor(progress * w);
    const colW = w / peaks.length;
    const barW = Math.max(1.2, colW * 0.62);

    peaks.forEach((p, i) => {
      const x = i * colW + (colW - barW) / 2;
      const bh = Math.max(1.4, p * (h - 8));
      const top = (h - bh) / 2;
      ctx.fillStyle = x + barW <= playedX ? fg : bg;
      ctx.fillRect(x, top, barW, bh);
    });

    // playhead
    if (peaks.length > 0 && playedX > 0) {
      ctx.fillStyle = fg;
      ctx.fillRect(playedX - 0.5, 0, 1, h);
      ctx.shadowColor = fg;
      ctx.shadowBlur = 8;
      ctx.fillRect(playedX - 0.5, 0, 1, h);
      ctx.shadowBlur = 0;
    }
  }, [peaks, progress, busy, height]);

  // re-render while busy to animate skeleton
  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => {
      const c = ref.current;
      if (!c) return;
      // trigger redraw by reading + writing
      c.style.opacity = '0.999';
      requestAnimationFrame(() => { if (c) c.style.opacity = '1'; });
    }, 80);
    return () => window.clearInterval(id);
  }, [busy]);

  return (
    <div className="w-full" style={{ height }}>
      <canvas ref={ref} className="block w-full" style={{ height: `${height}px` }} />
    </div>
  );
}
