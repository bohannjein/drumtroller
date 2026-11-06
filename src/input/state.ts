/** Unified controller state produced by both the WebHID driver and the Gamepad API fallback. */

export const BUTTONS = [
  'cross', 'circle', 'square', 'triangle',
  'l1', 'r1', 'l2', 'r2',
  'create', 'options', 'l3', 'r3',
  'up', 'down', 'left', 'right',
  'ps', 'touchpad', 'mute',
] as const;
export type ButtonId = (typeof BUTTONS)[number];

/** Continuous inputs, each normalised to the range noted. */
export const AXES = [
  'lx', 'ly', 'rx', 'ry',          // sticks, -1..1 (y: up = -1)
  'l2Analog', 'r2Analog',          // triggers, 0..1
  'pitch', 'roll', 'yaw',          // integrated orientation, -1..1 (= ±90°)
  'accX', 'accY', 'accZ',          // acceleration, -1..1 (= ±2 g)
  't1x', 't1y', 't2x', 't2y',      // touchpad fingers, 0..1
] as const;
export type AxisId = (typeof AXES)[number];

/** Pseudo buttons that are not physical buttons but can trigger notes. */
export const TOUCH_GATES = ['touch1', 'touch2'] as const;
export type TouchGateId = (typeof TOUCH_GATES)[number];

export type InputId = ButtonId | AxisId | TouchGateId;

export interface TouchPoint {
  active: boolean;
  id: number;
  /** 0..1 */
  x: number;
  /** 0..1 */
  y: number;
}

export interface ControllerState {
  buttons: Record<ButtonId, boolean>;
  sticks: { lx: number; ly: number; rx: number; ry: number };
  triggers: { l2: number; r2: number };
  /** Angular velocity in deg/s (x = pitch, y = yaw, z = roll). */
  gyro: { x: number; y: number; z: number };
  /** Acceleration in g. */
  accel: { x: number; y: number; z: number };
  touch: [TouchPoint, TouchPoint];
  /** 0..100, or null if unknown. */
  battery: number | null;
  charging: boolean;
  /** Whether motion/touch data is real (WebHID) or unavailable (Gamepad API fallback). */
  hasMotion: boolean;
  /** Sensor timestamp in microseconds (WebHID only), used for gyro integration. */
  timestampUs: number | null;
}

export function emptyState(): ControllerState {
  const buttons = {} as Record<ButtonId, boolean>;
  for (const b of BUTTONS) buttons[b] = false;
  return {
    buttons,
    sticks: { lx: 0, ly: 0, rx: 0, ry: 0 },
    triggers: { l2: 0, r2: 0 },
    gyro: { x: 0, y: 0, z: 0 },
    accel: { x: 0, y: 0, z: 0 },
    touch: [
      { active: false, id: 0, x: 0, y: 0 },
      { active: false, id: 0, x: 0, y: 0 },
    ],
    battery: null,
    charging: false,
    hasMotion: false,
    timestampUs: null,
  };
}

export const BUTTON_LABELS: Record<ButtonId, string> = {
  cross: '✕', circle: '○', square: '□', triangle: '△',
  l1: 'L1', r1: 'R1', l2: 'L2', r2: 'R2',
  create: 'CREATE', options: 'OPTIONS', l3: 'L3', r3: 'R3',
  up: '↑', down: '↓', left: '←', right: '→',
  ps: 'PS', touchpad: 'PAD', mute: 'MUTE',
};

export const AXIS_LABELS: Record<AxisId, string> = {
  lx: 'L-STICK X', ly: 'L-STICK Y', rx: 'R-STICK X', ry: 'R-STICK Y',
  l2Analog: 'L2 PRESSURE', r2Analog: 'R2 PRESSURE',
  pitch: 'GYRO PITCH', roll: 'GYRO ROLL', yaw: 'GYRO YAW',
  accX: 'ACCEL X', accY: 'ACCEL Y', accZ: 'ACCEL Z',
  t1x: 'TOUCH1 X', t1y: 'TOUCH1 Y', t2x: 'TOUCH2 X', t2y: 'TOUCH2 Y',
};

export const TOUCH_GATE_LABELS: Record<TouchGateId, string> = {
  touch1: 'TOUCH 1', touch2: 'TOUCH 2',
};

/** Axes that are bipolar (-1..1) as opposed to unipolar (0..1). */
export const BIPOLAR_AXES: ReadonlySet<AxisId> = new Set<AxisId>([
  'lx', 'ly', 'rx', 'ry', 'pitch', 'roll', 'yaw', 'accX', 'accY', 'accZ',
]);
