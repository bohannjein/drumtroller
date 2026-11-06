/**
 * Pure (DOM-free) DualSense HID report handling: input report parsing, calibration,
 * and output report construction. Byte layouts follow the Linux hid-playstation driver.
 */
import { crc32 } from './crc32';
import { emptyState, type ButtonId, type ControllerState } from './state';

export const SONY_VENDOR_ID = 0x054c;
export const DUALSENSE_PRODUCT_IDS = [0x0ce6 /* DualSense */, 0x0df2 /* DualSense Edge */];

export const TOUCHPAD_WIDTH = 1920;
export const TOUCHPAD_HEIGHT = 1080;

export type Transport = 'usb' | 'bt';

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

interface AxisCalib {
  bias: number;
  /** multiply (raw - bias) by this to get deg/s (gyro) or g (accel) */
  scale: number;
}

export interface Calibration {
  gyro: [AxisCalib, AxisCalib, AxisCalib];
  accel: [AxisCalib, AxisCalib, AxisCalib];
}

/** Rough defaults when the calibration feature report is unavailable. */
export const DEFAULT_CALIBRATION: Calibration = {
  gyro: [
    { bias: 0, scale: 1 / 16 },
    { bias: 0, scale: 1 / 16 },
    { bias: 0, scale: 1 / 16 },
  ],
  accel: [
    { bias: 0, scale: 1 / 8192 },
    { bias: 0, scale: 1 / 8192 },
    { bias: 0, scale: 1 / 8192 },
  ],
};

/**
 * Parses feature report 0x05. `view` may or may not include the leading report ID byte
 * (browsers differ), which is detected via its length.
 */
export function parseCalibration(view: DataView): Calibration {
  const o = view.byteLength >= 41 && view.getUint8(0) === 0x05 ? 1 : 0;
  if (view.byteLength < o + 34) return DEFAULT_CALIBRATION;
  const i16 = (off: number) => view.getInt16(o + off, true);

  const pitchBias = i16(0), yawBias = i16(2), rollBias = i16(4);
  const pitchPlus = i16(6), pitchMinus = i16(8);
  const yawPlus = i16(10), yawMinus = i16(12);
  const rollPlus = i16(14), rollMinus = i16(16);
  const speed2x = i16(18) + i16(20);

  const gyroAxis = (bias: number, plus: number, minus: number): AxisCalib => {
    const denom = plus - minus;
    if (!denom || !speed2x) return { bias: 0, scale: 1 / 16 };
    return { bias, scale: speed2x / denom };
  };
  const accAxis = (plus: number, minus: number): AxisCalib => {
    const range2g = plus - minus;
    if (!range2g) return { bias: 0, scale: 1 / 8192 };
    return { bias: plus - range2g / 2, scale: 2 / range2g };
  };

  return {
    gyro: [
      gyroAxis(pitchBias, pitchPlus, pitchMinus),
      gyroAxis(yawBias, yawPlus, yawMinus),
      gyroAxis(rollBias, rollPlus, rollMinus),
    ],
    accel: [
      accAxis(i16(22), i16(24)),
      accAxis(i16(26), i16(28)),
      accAxis(i16(30), i16(32)),
    ],
  };
}

// ---------------------------------------------------------------------------
// Input reports
// ---------------------------------------------------------------------------

const stick = (v: number) => {
  const n = (v - 128) / 127.5;
  return Math.max(-1, Math.min(1, n));
};

function applyHat(hat: number, b: Record<ButtonId, boolean>) {
  // 0 = N, clockwise to 7 = NW, 8 = released
  b.up = hat === 7 || hat === 0 || hat === 1;
  b.right = hat === 1 || hat === 2 || hat === 3;
  b.down = hat === 3 || hat === 4 || hat === 5;
  b.left = hat === 5 || hat === 6 || hat === 7;
}

function applyButtons(b0: number, b1: number, b2: number, b: Record<ButtonId, boolean>) {
  applyHat(b0 & 0x0f, b);
  b.square = !!(b0 & 0x10);
  b.cross = !!(b0 & 0x20);
  b.circle = !!(b0 & 0x40);
  b.triangle = !!(b0 & 0x80);
  b.l1 = !!(b1 & 0x01);
  b.r1 = !!(b1 & 0x02);
  b.l2 = !!(b1 & 0x04);
  b.r2 = !!(b1 & 0x08);
  b.create = !!(b1 & 0x10);
  b.options = !!(b1 & 0x20);
  b.l3 = !!(b1 & 0x40);
  b.r3 = !!(b1 & 0x80);
  b.ps = !!(b2 & 0x01);
  b.touchpad = !!(b2 & 0x02);
  b.mute = !!(b2 & 0x04);
}

/**
 * Parses an input report as delivered by WebHID (`data` excludes the report ID).
 * Returns null for unknown reports.
 *  - USB full report:        id 0x01, 63 bytes
 *  - Bluetooth simple report: id 0x01, ~9 bytes (before switching to the extended mode)
 *  - Bluetooth full report:  id 0x31, 77 bytes (1 extra leading byte)
 */
export function parseInputReport(
  reportId: number,
  data: DataView,
  calib: Calibration = DEFAULT_CALIBRATION,
): ControllerState | null {
  const s = emptyState();

  if (reportId === 0x01 && data.byteLength < 20) {
    // Bluetooth "simple" report: no motion/touch data.
    if (data.byteLength < 9) return null;
    s.sticks.lx = stick(data.getUint8(0));
    s.sticks.ly = stick(data.getUint8(1));
    s.sticks.rx = stick(data.getUint8(2));
    s.sticks.ry = stick(data.getUint8(3));
    applyButtons(data.getUint8(4), data.getUint8(5), data.getUint8(6), s.buttons);
    s.triggers.l2 = data.getUint8(7) / 255;
    s.triggers.r2 = data.getUint8(8) / 255;
    return s;
  }

  let o: number;
  if (reportId === 0x01) o = 0;
  else if (reportId === 0x31) o = 1;
  else return null;
  if (data.byteLength < o + 53) return null;

  const u8 = (i: number) => data.getUint8(o + i);
  const i16 = (i: number) => data.getInt16(o + i, true);

  s.sticks.lx = stick(u8(0));
  s.sticks.ly = stick(u8(1));
  s.sticks.rx = stick(u8(2));
  s.sticks.ry = stick(u8(3));
  s.triggers.l2 = u8(4) / 255;
  s.triggers.r2 = u8(5) / 255;
  applyButtons(u8(7), u8(8), u8(9), s.buttons);

  const g = calib.gyro, a = calib.accel;
  s.gyro.x = (i16(15) - g[0].bias) * g[0].scale;
  s.gyro.y = (i16(17) - g[1].bias) * g[1].scale;
  s.gyro.z = (i16(19) - g[2].bias) * g[2].scale;
  s.accel.x = (i16(21) - a[0].bias) * a[0].scale;
  s.accel.y = (i16(23) - a[1].bias) * a[1].scale;
  s.accel.z = (i16(25) - a[2].bias) * a[2].scale;
  // Sensor timestamp ticks are 1/3 µs.
  s.timestampUs = data.getUint32(o + 27, true) / 3;

  for (let i = 0; i < 2; i++) {
    const base = 32 + i * 4;
    const contact = u8(base);
    const b1 = u8(base + 1), b2 = u8(base + 2), b3 = u8(base + 3);
    const x = b1 | ((b2 & 0x0f) << 8);
    const y = (b2 >> 4) | (b3 << 4);
    s.touch[i] = {
      active: !(contact & 0x80),
      id: contact & 0x7f,
      x: Math.min(1, x / (TOUCHPAD_WIDTH - 1)),
      y: Math.min(1, y / (TOUCHPAD_HEIGHT - 1)),
    };
  }

  const status = u8(52);
  const level = status & 0x0f;
  const chargeState = (status & 0xf0) >> 4;
  s.battery = Math.min(100, level * 10 + 5);
  if (chargeState === 0x2) s.battery = 100;
  s.charging = chargeState === 0x1;
  s.hasMotion = true;
  return s;
}

// ---------------------------------------------------------------------------
// Output reports
// ---------------------------------------------------------------------------

export type TriggerEffect =
  | { mode: 'off' }
  /** Continuous resistance from `position` (0-9) on, strength 1-8. */
  | { mode: 'feedback'; position: number; strength: number }
  /** "Gun trigger": resistance between start (2-7) and end (start+1..8) that snaps. */
  | { mode: 'weapon'; start: number; end: number; strength: number }
  /** Vibration from `position` (0-9), amplitude 1-8, frequency 1-255 Hz. */
  | { mode: 'vibration'; position: number; amplitude: number; frequency: number };

export interface OutputState {
  /** 0-255 */
  rumbleLeft: number;
  /** 0-255 */
  rumbleRight: number;
  lightbar: [number, number, number];
  /** 5-bit mask, bit 0 = leftmost LED */
  playerLeds: number;
  muteLed: boolean;
  l2Effect: TriggerEffect;
  r2Effect: TriggerEffect;
}

export function defaultOutput(): OutputState {
  return {
    rumbleLeft: 0,
    rumbleRight: 0,
    lightbar: [255, 120, 0],
    playerLeds: 0x04,
    muteLed: false,
    l2Effect: { mode: 'off' },
    r2Effect: { mode: 'off' },
  };
}

const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

/** Encodes one adaptive trigger effect into its 11-byte block. */
export function encodeTriggerEffect(e: TriggerEffect): Uint8Array {
  const out = new Uint8Array(11);
  switch (e.mode) {
    case 'off':
      out[0] = 0x05; // reset
      return out;
    case 'feedback': {
      const pos = clampInt(e.position, 0, 9);
      const force = (clampInt(e.strength, 1, 8) - 1) & 0x07;
      let zones = 0, active = 0;
      for (let i = pos; i < 10; i++) {
        zones += force * 2 ** (3 * i);
        active |= 1 << i;
      }
      out[0] = 0x21;
      out[1] = active & 0xff;
      out[2] = (active >> 8) & 0xff;
      for (let k = 0; k < 4; k++) out[3 + k] = Math.floor(zones / 2 ** (8 * k)) & 0xff;
      return out;
    }
    case 'weapon': {
      const start = clampInt(e.start, 2, 7);
      const end = clampInt(e.end, start + 1, 8);
      const zones = (1 << start) | (1 << end);
      out[0] = 0x25;
      out[1] = zones & 0xff;
      out[2] = (zones >> 8) & 0xff;
      out[3] = clampInt(e.strength, 1, 8) - 1;
      return out;
    }
    case 'vibration': {
      const pos = clampInt(e.position, 0, 9);
      const amp = (clampInt(e.amplitude, 1, 8) - 1) & 0x07;
      let zones = 0, active = 0;
      for (let i = pos; i < 10; i++) {
        zones += amp * 2 ** (3 * i);
        active |= 1 << i;
      }
      out[0] = 0x26;
      out[1] = active & 0xff;
      out[2] = (active >> 8) & 0xff;
      for (let k = 0; k < 4; k++) out[3 + k] = Math.floor(zones / 2 ** (8 * k)) & 0xff;
      out[9] = clampInt(e.frequency, 1, 255);
      return out;
    }
  }
}

/** The 47-byte "common" output block shared by USB and Bluetooth reports. */
export function buildCommonOutput(st: OutputState, opts: { initLightbar?: boolean } = {}): Uint8Array {
  const c = new Uint8Array(47);
  // valid_flag0: compatible vibration | haptics select | right trigger | left trigger
  c[0] = 0x01 | 0x02 | 0x04 | 0x08;
  // valid_flag1: mic mute LED | lightbar | player indicator
  c[1] = 0x01 | 0x04 | 0x10;
  c[2] = clampInt(st.rumbleRight, 0, 255);
  c[3] = clampInt(st.rumbleLeft, 0, 255);
  c[8] = st.muteLed ? 1 : 0;
  c.set(encodeTriggerEffect(st.r2Effect), 10);
  c.set(encodeTriggerEffect(st.l2Effect), 21);
  // valid_flag2: compatible vibration v2 (newer firmware), optionally lightbar setup
  c[38] = 0x04 | (opts.initLightbar ? 0x02 : 0);
  if (opts.initLightbar) c[41] = 0x02; // LIGHTBAR_SETUP_LIGHT_OUT: release the default blue pulse
  c[43] = (st.playerLeds & 0x1f) | 0x20; // 0x20 = instant (no fade)
  c[44] = clampInt(st.lightbar[0], 0, 255);
  c[45] = clampInt(st.lightbar[1], 0, 255);
  c[46] = clampInt(st.lightbar[2], 0, 255);
  return c;
}

/** USB: report ID 0x02, 47 payload bytes. */
export function buildUsbOutputReport(st: OutputState, opts?: { initLightbar?: boolean }) {
  return { reportId: 0x02, data: buildCommonOutput(st, opts) };
}

/**
 * Bluetooth: report ID 0x31, 77 payload bytes:
 * [seq_tag, tag=0x10, common(47), reserved(24), crc32(4)].
 * The CRC covers 0xA2 (HID output header), the report ID, and the payload without the CRC.
 */
export function buildBtOutputReport(st: OutputState, seq: number, opts?: { initLightbar?: boolean }) {
  const data = new Uint8Array(77);
  data[0] = (seq & 0x0f) << 4;
  data[1] = 0x10;
  data.set(buildCommonOutput(st, opts), 2);
  const crcInput = new Uint8Array(2 + 73);
  crcInput[0] = 0xa2;
  crcInput[1] = 0x31;
  crcInput.set(data.subarray(0, 73), 2);
  const crc = crc32(crcInput);
  new DataView(data.buffer).setUint32(73, crc, true);
  return { reportId: 0x31, data };
}

/** Player LED patterns for presets 1-4 (as on the PS5). */
export const PLAYER_LED_PATTERNS = [0x04, 0x0a, 0x15, 0x1b];
