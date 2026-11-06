/** Mapping model, default presets P1–P4 and persistence. */
import {
  AXES,
  BUTTONS,
  TOUCH_GATES,
  type AxisId,
  type ButtonId,
  type InputId,
} from '../input/state';

export type Curve = 'linear' | 'exp' | 'log';

export type Mapping =
  | { type: 'off' }
  | { type: 'note'; note: number; velocity: number; channel: number }
  | { type: 'cc'; cc: number; channel: number; invert: boolean; curve: Curve; min: number; max: number }
  | { type: 'pitchbend'; channel: number; invert: boolean };

export type MappingType = Mapping['type'];

export interface Preset {
  name: string;
  /** Lightbar / UI accent colour */
  color: [number, number, number];
  /** Use motion jolt (accelerometer) to set note velocity – hit the air like a drumstick. */
  velocityFromMotion: boolean;
  map: Record<MappableInput, Mapping>;
}

/** Buttons with fixed system functions that cannot be mapped. */
export const SYSTEM_BUTTONS = {
  ps: 'NÄCHSTES PRESET',
  mute: 'MOTION AN/AUS',
  create: 'GYRO ZENTRIEREN',
} as const satisfies Partial<Record<ButtonId, string>>;
type SystemButton = keyof typeof SYSTEM_BUTTONS;

export type MappableButton = Exclude<ButtonId, SystemButton>;
export type MappableInput = MappableButton | AxisId | (typeof TOUCH_GATES)[number];

export const MAPPABLE_BUTTONS = BUTTONS.filter(
  (b): b is MappableButton => !(b in SYSTEM_BUTTONS),
);
/** Inputs that fire notes (on/off) */
export const GATE_INPUTS: MappableInput[] = [...MAPPABLE_BUTTONS, ...TOUCH_GATES];
/** Inputs that produce continuous values */
export const CONTINUOUS_INPUTS: MappableInput[] = [...AXES];
export const MAPPABLE_INPUTS: MappableInput[] = [...GATE_INPUTS, ...CONTINUOUS_INPUTS];

export function isGate(id: InputId): boolean {
  return (GATE_INPUTS as InputId[]).includes(id);
}

// Note numbers (Ableton naming: C1 = 36). P1 matches the layout in the reference video.
const DRUM_NOTES: Partial<Record<MappableInput, number>> = {
  up: 36, // C1
  left: 37, // C#1
  down: 38, // D1
  right: 39, // D#1
  triangle: 40, // E1
  square: 41, // F1
  cross: 42, // F#1
  circle: 43, // G1
  l1: 44, // G#1
  r1: 45, // A1
  l2: 46, // A#1
  r2: 47, // B1
  l3: 48, // C2
  r3: 49, // C#2
  touchpad: 50, // D2
  options: 51, // D#2
  touch1: 52, // E2
  touch2: 53, // F2
};

const CC_NUMBERS: Record<AxisId, number> = {
  lx: 20, ly: 21, rx: 22, ry: 23,
  l2Analog: 24, r2Analog: 25,
  pitch: 26, roll: 27, yaw: 28,
  accX: 29, accY: 30, accZ: 31,
  t1x: 102, t1y: 103, t2x: 104, t2y: 105,
};

/** Accelerometer CCs are very busy, so they start disabled. */
const OFF_BY_DEFAULT: AxisId[] = ['accX', 'accY', 'accZ'];

export const PRESET_COLORS: [number, number, number][] = [
  [255, 128, 0], // P1 orange
  [0, 140, 255], // P2 blue
  [40, 255, 60], // P3 green
  [255, 0, 200], // P4 magenta
];

export function defaultPreset(index: number): Preset {
  const channel = index + 1; // P1 → ch 1 … P4 → ch 4
  const map = {} as Record<MappableInput, Mapping>;
  for (const id of GATE_INPUTS) {
    const note = DRUM_NOTES[id];
    map[id] = note == null ? { type: 'off' } : { type: 'note', note, velocity: 100, channel };
  }
  for (const id of AXES) {
    map[id] = OFF_BY_DEFAULT.includes(id)
      ? { type: 'off' }
      : {
          type: 'cc',
          cc: CC_NUMBERS[id],
          channel,
          invert: id === 'ly' || id === 'ry', // stick up = high value
          curve: 'linear',
          min: 0,
          max: 127,
        };
  }
  return {
    name: `P${index + 1}`,
    color: [...PRESET_COLORS[index]] as [number, number, number],
    velocityFromMotion: false,
    map,
  };
}

export function defaultMappingFor(id: MappableInput, type: MappingType, channel: number): Mapping {
  switch (type) {
    case 'off':
      return { type: 'off' };
    case 'note':
      return { type: 'note', note: DRUM_NOTES[id] ?? 60, velocity: 100, channel };
    case 'cc':
      return {
        type: 'cc',
        cc: (CC_NUMBERS as Record<string, number>)[id] ?? 20,
        channel,
        invert: false,
        curve: 'linear',
        min: 0,
        max: 127,
      };
    case 'pitchbend':
      return { type: 'pitchbend', channel, invert: false };
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'drumtroller.presets.v1';

export interface PresetBank {
  active: number;
  presets: Preset[];
}

export function defaultBank(): PresetBank {
  return { active: 0, presets: [0, 1, 2, 3].map(defaultPreset) };
}

/** Repairs anything missing from stored/imported data so new inputs get defaults. */
export function sanitizeBank(raw: unknown): PresetBank {
  const bank = defaultBank();
  if (!raw || typeof raw !== 'object') return bank;
  const r = raw as Partial<PresetBank>;
  if (typeof r.active === 'number' && r.active >= 0 && r.active < 4) bank.active = r.active;
  if (Array.isArray(r.presets)) {
    r.presets.slice(0, 4).forEach((p, i) => {
      if (!p || typeof p !== 'object') return;
      const target = bank.presets[i];
      if (typeof p.name === 'string') target.name = p.name.slice(0, 16);
      if (Array.isArray(p.color) && p.color.length === 3) target.color = p.color.map(Number) as Preset['color'];
      target.velocityFromMotion = !!p.velocityFromMotion;
      if (p.map && typeof p.map === 'object') {
        for (const id of MAPPABLE_INPUTS) {
          const m = (p.map as Record<string, Mapping>)[id];
          if (m && typeof m === 'object' && ['off', 'note', 'cc', 'pitchbend'].includes(m.type)) {
            target.map[id] = { ...defaultMappingFor(id, m.type, i + 1), ...m } as Mapping;
          }
        }
      }
    });
  }
  return bank;
}

export function loadBank(): PresetBank {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeBank(JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt */
  }
  return defaultBank();
}

export function saveBank(bank: PresetBank) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bank));
  } catch {
    /* storage unavailable */
  }
}
