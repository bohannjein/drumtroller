import { describe, expect, it } from 'vitest';
import { crc32 } from '../src/input/crc32';
import {
  buildBtOutputReport,
  buildUsbOutputReport,
  defaultOutput,
  encodeTriggerEffect,
  parseCalibration,
  parseInputReport,
} from '../src/input/dualsense-report';
import { btReport, usbReport } from './fixtures';

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('parseInputReport (USB 0x01)', () => {
  it('parses sticks, triggers and face buttons', () => {
    const s = parseInputReport(0x01, usbReport({ lx: 0, ly: 255, l2: 255, r2: 51, b0: 0x08 | 0x20 | 0x80 }))!;
    expect(s.sticks.lx).toBeCloseTo(-1, 2);
    expect(s.sticks.ly).toBeCloseTo(1, 2);
    expect(s.sticks.rx).toBeCloseTo(0, 1);
    expect(s.triggers.l2).toBe(1);
    expect(s.triggers.r2).toBeCloseTo(0.2, 2);
    expect(s.buttons.cross).toBe(true);
    expect(s.buttons.triangle).toBe(true);
    expect(s.buttons.square).toBe(false);
    expect(s.buttons.circle).toBe(false);
    expect(s.hasMotion).toBe(true);
  });

  it('decodes the d-pad hat including diagonals', () => {
    const at = (hat: number) => parseInputReport(0x01, usbReport({ b0: hat }))!.buttons;
    expect(at(0)).toMatchObject({ up: true, right: false, down: false, left: false });
    expect(at(1)).toMatchObject({ up: true, right: true });
    expect(at(4)).toMatchObject({ down: true, up: false });
    expect(at(6)).toMatchObject({ left: true, up: false });
    expect(at(8)).toMatchObject({ up: false, right: false, down: false, left: false });
  });

  it('parses shoulder and system buttons', () => {
    const s = parseInputReport(0x01, usbReport({ b1: 0x01 | 0x08 | 0x40, b2: 0x01 | 0x02 | 0x04 }))!;
    expect(s.buttons).toMatchObject({ l1: true, r1: false, r2: true, l3: true, ps: true, touchpad: true, mute: true });
  });

  it('parses gyro, accel and timestamp with default calibration', () => {
    const s = parseInputReport(0x01, usbReport({ gyro: [160, -320, 16], accel: [0, 8192, -4096], timestamp: 3000 }))!;
    expect(s.gyro.x).toBeCloseTo(10);
    expect(s.gyro.y).toBeCloseTo(-20);
    expect(s.gyro.z).toBeCloseTo(1);
    expect(s.accel.y).toBeCloseTo(1);
    expect(s.accel.z).toBeCloseTo(-0.5);
    expect(s.timestampUs).toBeCloseTo(1000);
  });

  it('parses two touch points with 12-bit coordinates', () => {
    const s = parseInputReport(0x01, usbReport({ touch: [{ x: 1919, y: 0 }, { x: 960, y: 1079, id: 5 }] }))!;
    expect(s.touch[0]).toMatchObject({ active: true, x: 1, y: 0 });
    expect(s.touch[1].active).toBe(true);
    expect(s.touch[1].id).toBe(5);
    expect(s.touch[1].x).toBeCloseTo(960 / 1919, 4);
    expect(s.touch[1].y).toBe(1);
    const none = parseInputReport(0x01, usbReport())!;
    expect(none.touch[0].active).toBe(false);
  });

  it('reads battery level and charging state', () => {
    expect(parseInputReport(0x01, usbReport({ status: 0x05 }))!).toMatchObject({ battery: 55, charging: false });
    expect(parseInputReport(0x01, usbReport({ status: 0x13 }))!).toMatchObject({ battery: 35, charging: true });
    expect(parseInputReport(0x01, usbReport({ status: 0x20 }))!.battery).toBe(100);
  });
});

describe('parseInputReport (Bluetooth)', () => {
  it('parses the extended 0x31 report at a +1 offset', () => {
    const s = parseInputReport(0x31, btReport({ rx: 255, b0: 0x08 | 0x40, touch: [{ x: 100, y: 200 }, null] }))!;
    expect(s.sticks.rx).toBeCloseTo(1, 2);
    expect(s.buttons.circle).toBe(true);
    expect(s.touch[0].active).toBe(true);
    expect(s.touch[0].x).toBeCloseTo(100 / 1919, 4);
    expect(s.touch[0].y).toBeCloseTo(200 / 1079, 4);
    expect(s.hasMotion).toBe(true);
  });

  it('parses the simple BT report without motion', () => {
    const d = new DataView(new Uint8Array([0, 128, 128, 255, 0x08 | 0x10, 0x02, 0x01, 255, 0]).buffer);
    const s = parseInputReport(0x01, d)!;
    expect(s.sticks.lx).toBeCloseTo(-1, 2);
    expect(s.sticks.ry).toBeCloseTo(1, 2);
    expect(s.buttons.square).toBe(true);
    expect(s.buttons.r1).toBe(true);
    expect(s.buttons.ps).toBe(true);
    expect(s.triggers.l2).toBe(1);
    expect(s.hasMotion).toBe(false);
  });

  it('ignores unknown reports', () => {
    expect(parseInputReport(0x05, usbReport())).toBeNull();
  });
});

describe('parseCalibration', () => {
  it('derives gyro and accel scale from feature report 0x05 (with report id)', () => {
    const buf = new Uint8Array(41);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x05;
    const w = (off: number, v: number) => dv.setInt16(1 + off, v, true);
    w(0, 10); w(2, -5); w(4, 0); // biases
    w(6, 8000); w(8, -8000); // pitch +/-
    w(10, 8000); w(12, -8000); // yaw
    w(14, 8000); w(16, -8000); // roll
    w(18, 500); w(20, 500); // speed +/-  → 1000 deg/s over 16000 counts
    w(22, 8192); w(24, -8192); // acc x
    w(26, 8292); w(28, -8092); // acc y (bias +100)
    w(30, 8192); w(32, -8192); // acc z
    const c = parseCalibration(dv);
    expect(c.gyro[0].bias).toBe(10);
    expect(c.gyro[0].scale).toBeCloseTo(1000 / 16000);
    expect(c.accel[1].bias).toBe(100);
    expect(c.accel[0].scale).toBeCloseTo(1 / 8192);

    const s = parseInputReport(0x01, usbReport({ gyro: [10 + 1600, 0, 0], accel: [0, 8292, 0] }), c)!;
    expect(s.gyro.x).toBeCloseTo(100);
    expect(s.accel.y).toBeCloseTo(1);
  });
});

describe('output reports', () => {
  it('builds a 47 byte USB report with lightbar, LEDs and rumble', () => {
    const st = { ...defaultOutput(), lightbar: [1, 2, 3] as [number, number, number], playerLeds: 0x15, rumbleLeft: 9, rumbleRight: 7, muteLed: true };
    const { reportId, data } = buildUsbOutputReport(st);
    expect(reportId).toBe(0x02);
    expect(data.length).toBe(47);
    expect(data[2]).toBe(7);
    expect(data[3]).toBe(9);
    expect(data[8]).toBe(1);
    expect(data[43] & 0x1f).toBe(0x15);
    expect([data[44], data[45], data[46]]).toEqual([1, 2, 3]);
  });

  it('builds a BT report with a valid CRC32', () => {
    const { reportId, data } = buildBtOutputReport(defaultOutput(), 3);
    expect(reportId).toBe(0x31);
    expect(data.length).toBe(77);
    expect(data[0]).toBe(0x30);
    expect(data[1]).toBe(0x10);
    const check = new Uint8Array(75);
    check[0] = 0xa2;
    check[1] = 0x31;
    check.set(data.subarray(0, 73), 2);
    expect(new DataView(data.buffer).getUint32(73, true)).toBe(crc32(check));
  });

  it('encodes adaptive trigger effects', () => {
    expect(encodeTriggerEffect({ mode: 'off' })[0]).toBe(0x05);
    const fb = encodeTriggerEffect({ mode: 'feedback', position: 8, strength: 8 });
    expect(fb[0]).toBe(0x21);
    // zones 8 and 9 active
    expect(fb[1] | (fb[2] << 8)).toBe((1 << 8) | (1 << 9));
    // force 7 in zone 8 (bits 24-26) and zone 9 (bits 27-29)
    const forces = fb[3] | (fb[4] << 8) | (fb[5] << 16) | (fb[6] << 24);
    expect(forces >>> 0).toBe(((7 << 24) | (7 << 27)) >>> 0);
    const wp = encodeTriggerEffect({ mode: 'weapon', start: 3, end: 6, strength: 5 });
    expect([wp[0], wp[1] | (wp[2] << 8), wp[3]]).toEqual([0x25, (1 << 3) | (1 << 6), 4]);
    const vib = encodeTriggerEffect({ mode: 'vibration', position: 0, amplitude: 1, frequency: 40 });
    expect(vib[0]).toBe(0x26);
    expect(vib[9]).toBe(40);
  });
});
