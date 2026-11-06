/** Helpers to build synthetic DualSense input reports (data without report ID). */

export interface ReportSpec {
  lx?: number; ly?: number; rx?: number; ry?: number;
  l2?: number; r2?: number;
  b0?: number; b1?: number; b2?: number;
  gyro?: [number, number, number];
  accel?: [number, number, number];
  timestamp?: number;
  touch?: ({ x: number; y: number; id?: number } | null)[];
  status?: number;
}

export function usbReport(spec: ReportSpec = {}): DataView {
  return build(spec, 63, 0);
}

export function btReport(spec: ReportSpec = {}): DataView {
  return build(spec, 77, 1);
}

function build(spec: ReportSpec, len: number, o: number): DataView {
  const buf = new Uint8Array(len);
  const dv = new DataView(buf.buffer);
  buf[o + 0] = spec.lx ?? 128;
  buf[o + 1] = spec.ly ?? 128;
  buf[o + 2] = spec.rx ?? 128;
  buf[o + 3] = spec.ry ?? 128;
  buf[o + 4] = spec.l2 ?? 0;
  buf[o + 5] = spec.r2 ?? 0;
  buf[o + 7] = spec.b0 ?? 0x08; // hat released
  buf[o + 8] = spec.b1 ?? 0;
  buf[o + 9] = spec.b2 ?? 0;
  const g = spec.gyro ?? [0, 0, 0];
  const a = spec.accel ?? [0, 8192, 0];
  g.forEach((v, i) => dv.setInt16(o + 15 + i * 2, v, true));
  a.forEach((v, i) => dv.setInt16(o + 21 + i * 2, v, true));
  dv.setUint32(o + 27, spec.timestamp ?? 0, true);
  const touch = spec.touch ?? [null, null];
  for (let i = 0; i < 2; i++) {
    const t = touch[i];
    const base = o + 32 + i * 4;
    if (!t) {
      buf[base] = 0x80;
      continue;
    }
    buf[base] = (t.id ?? i) & 0x7f;
    buf[base + 1] = t.x & 0xff;
    buf[base + 2] = ((t.x >> 8) & 0x0f) | ((t.y & 0x0f) << 4);
    buf[base + 3] = (t.y >> 4) & 0xff;
  }
  buf[o + 52] = spec.status ?? 0x08;
  return dv;
}
