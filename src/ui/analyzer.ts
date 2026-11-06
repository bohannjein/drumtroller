/** Winamp-style LED spectrum analyzer: one bar per continuous input, with falling peak caps. */
import { AXES, BIPOLAR_AXES, type AxisId } from '../input/state';

const SHORT: Record<AxisId, string> = {
  lx: 'LX', ly: 'LY', rx: 'RX', ry: 'RY', l2Analog: 'L2', r2Analog: 'R2',
  pitch: 'PIT', roll: 'ROL', yaw: 'YAW', accX: 'AX', accY: 'AY', accZ: 'AZ',
  t1x: 'T1X', t1y: 'T1Y', t2x: 'T2X', t2y: 'T2Y',
};

const SEGMENTS = 16;

export class Analyzer {
  private ctx: CanvasRenderingContext2D;
  private peaks = new Map<AxisId, number>();
  private colors = { low: '#33ff33', mid: '#ffee00', high: '#ff3300', off: '#123', label: '#7fa', peak: '#fff' };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.readColors();
  }

  readColors() {
    const cs = getComputedStyle(this.canvas);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    this.colors = {
      low: v('--viz-low', '#33ff33'),
      mid: v('--viz-mid', '#ffee00'),
      high: v('--viz-high', '#ff3300'),
      off: v('--viz-off', '#0d1a14'),
      label: v('--lcd-fg', '#7fffa0'),
      peak: v('--viz-peak', '#ffffff'),
    };
  }

  render(values: Record<AxisId, number>, sent: Record<AxisId, number | null>) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const labelH = 11;
    const n = AXES.length;
    const gap = 3;
    const bw = (w - gap * (n + 1)) / n;
    const segH = (h - labelH - 4) / SEGMENTS;
    ctx.font = '9px "VT323", monospace';
    ctx.textAlign = 'center';

    AXES.forEach((id, i) => {
      const raw = values[id];
      const level = BIPOLAR_AXES.has(id) ? (raw + 1) / 2 : raw;
      const active = sent[id] != null;
      const lit = Math.round(Math.max(0, Math.min(1, level)) * SEGMENTS);
      const x = gap + i * (bw + gap);

      let peak = this.peaks.get(id) ?? 0;
      peak = lit >= peak ? lit : Math.max(lit, peak - 0.15);
      this.peaks.set(id, peak);

      for (let sgm = 0; sgm < SEGMENTS; sgm++) {
        const y = h - labelH - (sgm + 1) * segH;
        const f = sgm / SEGMENTS;
        const col = f > 0.8 ? this.colors.high : f > 0.55 ? this.colors.mid : this.colors.low;
        ctx.globalAlpha = sgm < lit ? (active ? 1 : 0.3) : 1;
        ctx.fillStyle = sgm < lit ? col : this.colors.off;
        ctx.fillRect(x, y + 1, bw, segH - 1.5);
      }
      const py = h - labelH - Math.ceil(peak) * segH;
      ctx.globalAlpha = active ? 0.95 : 0.35;
      ctx.fillStyle = this.colors.peak;
      ctx.fillRect(x, py + 1, bw, 1.5);
      ctx.globalAlpha = active ? 1 : 0.45;
      ctx.fillStyle = this.colors.label;
      ctx.fillText(SHORT[id], x + bw / 2, h - 2);
    });
    ctx.globalAlpha = 1;
  }
}

/** Round LCD "radar" showing tilt (dot) and yaw (needle). */
export class GyroRadar {
  constructor(private dot: SVGCircleElement, private needle: SVGLineElement) {}

  render(pitch: number, roll: number, yaw: number) {
    // inputs in -1..1
    this.dot.setAttribute('cx', String(50 + roll * 38));
    this.dot.setAttribute('cy', String(50 - pitch * 38));
    const a = yaw * Math.PI * 0.5;
    this.needle.setAttribute('x2', String(50 + Math.sin(a) * 40));
    this.needle.setAttribute('y2', String(50 - Math.cos(a) * 40));
  }
}
