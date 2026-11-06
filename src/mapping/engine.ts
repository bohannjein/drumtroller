/** Turns controller state into MIDI messages according to the active preset. */
import type { MidiSink } from '../midi/midi-out';
import type { MotionTracker } from '../input/motion';
import { AXES, BIPOLAR_AXES, type AxisId, type ControllerState } from '../input/state';
import { GATE_INPUTS, type Curve, type Mapping, type MappableInput, type Preset } from './presets';

const STICK_DEADZONE = 0.08;
/** Minimum time between two messages on the same CC/pitchbend lane. */
const MIN_CC_INTERVAL_MS = 8;
const MOTION_AXES = new Set<AxisId>(['pitch', 'roll', 'yaw', 'accX', 'accY', 'accZ']);
const TOUCH_AXES = new Set<AxisId>(['t1x', 't1y', 't2x', 't2y']);

export interface NoteEvent {
  input: MappableInput;
  note: number;
  velocity: number;
  channel: number;
  on: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function deadzone(v: number) {
  const a = Math.abs(v);
  if (a < STICK_DEADZONE) return 0;
  return (Math.sign(v) * (a - STICK_DEADZONE)) / (1 - STICK_DEADZONE);
}

function applyCurve(u: number, c: Curve) {
  if (c === 'exp') return u * u;
  if (c === 'log') return Math.sqrt(u);
  return u;
}

/** Maps a normalised axis value to 0..1 using invert + curve. Bipolar curves are symmetric. */
export function shapeValue(v: number, bipolar: boolean, invert: boolean, curve: Curve): number {
  if (bipolar) {
    let x = clamp(v, -1, 1);
    if (invert) x = -x;
    x = Math.sign(x) * applyCurve(Math.abs(x), curve);
    return (x + 1) / 2;
  }
  let u = clamp(v, 0, 1);
  if (invert) u = 1 - u;
  return applyCurve(u, curve);
}

export class MappingEngine {
  inputOn = true;
  motionOn = true;
  /** When set, only this input sends MIDI (to make MIDI-learn in the DAW easy). */
  solo: MappableInput | null = null;

  /** Latest normalised values for the UI (bipolar -1..1, unipolar 0..1). */
  readonly values = Object.fromEntries(AXES.map((a) => [a, 0])) as Record<AxisId, number>;
  /** Latest gate states for the UI. */
  readonly gates = Object.fromEntries(GATE_INPUTS.map((g) => [g, false])) as Record<MappableInput, boolean>;
  /** Last value sent per axis (0..127), for the analyzer; null if the axis is not sending. */
  readonly sent = Object.fromEntries(AXES.map((a) => [a, null])) as Record<AxisId, number | null>;

  onNote: ((e: NoteEvent) => void) | null = null;

  private held = new Map<MappableInput, { note: number; channel: number }>();
  private lastLane = new Map<string, { value: number; t: number }>();
  private jolt = 0;
  private lastAccel: { x: number; y: number; z: number } | null = null;
  private lastT = 0;

  constructor(
    private midi: MidiSink,
    public preset: Preset,
  ) {}

  setPreset(p: Preset) {
    this.allNotesOff();
    this.preset = p;
    this.lastLane.clear();
  }

  /** Forget lanes so every CC is re-sent on the next update (e.g. after a mapping edit). */
  resync() {
    this.lastLane.clear();
  }

  allNotesOff() {
    for (const [input, h] of this.held) this.noteOff(input, h.note, h.channel);
    this.held.clear();
  }

  process(s: ControllerState, motion: MotionTracker, nowMs: number) {
    const v = this.values;
    v.lx = deadzone(s.sticks.lx);
    v.ly = deadzone(s.sticks.ly);
    v.rx = deadzone(s.sticks.rx);
    v.ry = deadzone(s.sticks.ry);
    v.l2Analog = s.triggers.l2;
    v.r2Analog = s.triggers.r2;
    if (s.hasMotion) {
      v.pitch = clamp(motion.pitch / 90, -1, 1);
      v.roll = clamp(motion.roll / 90, -1, 1);
      v.yaw = clamp(motion.yaw / 90, -1, 1);
      v.accX = clamp(s.accel.x / 2, -1, 1);
      v.accY = clamp(s.accel.y / 2, -1, 1);
      v.accZ = clamp(s.accel.z / 2, -1, 1);
      // Touch positions hold their last value when the finger is lifted.
      if (s.touch[0].active) {
        v.t1x = s.touch[0].x;
        v.t1y = s.touch[0].y;
      }
      if (s.touch[1].active) {
        v.t2x = s.touch[1].x;
        v.t2y = s.touch[1].y;
      }
      this.trackJolt(s, nowMs);
    }

    // Gates (notes)
    for (const id of GATE_INPUTS) {
      const pressed =
        id === 'touch1' ? s.touch[0].active : id === 'touch2' ? s.touch[1].active : s.buttons[id as keyof typeof s.buttons];
      const was = this.gates[id];
      this.gates[id] = pressed;
      if (pressed === was) continue;
      if (pressed) this.gateOn(id, s.hasMotion);
      else this.gateOff(id);
    }

    // Continuous lanes
    for (const id of AXES) {
      const m = this.preset.map[id];
      const active =
        this.inputOn &&
        (this.solo == null || this.solo === id) &&
        (!MOTION_AXES.has(id) || (this.motionOn && s.hasMotion)) &&
        (!TOUCH_AXES.has(id) || s.hasMotion);
      if (!active || m.type === 'off' || m.type === 'note') {
        this.sent[id] = null;
        continue;
      }
      const u = shapeValue(v[id], BIPOLAR_AXES.has(id), m.invert, m.type === 'cc' ? m.curve : 'linear');
      if (m.type === 'cc') {
        const value = Math.round(m.min + u * (m.max - m.min));
        this.sent[id] = value;
        this.lane(`cc:${m.channel}:${m.cc}`, value, nowMs, () =>
          this.midi.send([0xb0 | (m.channel - 1), m.cc & 0x7f, clamp(value, 0, 127)]),
        );
      } else {
        // Bipolar axes bend both ways; unipolar ones bend up from centre.
        const bend = Math.round(BIPOLAR_AXES.has(id) ? u * 16383 : 8192 + u * 8191);
        this.sent[id] = bend >> 7;
        this.lane(`pb:${m.channel}`, bend, nowMs, () =>
          this.midi.send([0xe0 | (m.channel - 1), bend & 0x7f, (bend >> 7) & 0x7f]),
        );
      }
    }
  }

  private lane(key: string, value: number, now: number, send: () => void) {
    const last = this.lastLane.get(key);
    if (last && (last.value === value || now - last.t < MIN_CC_INTERVAL_MS)) return;
    this.lastLane.set(key, { value, t: now });
    send();
  }

  private trackJolt(s: ControllerState, now: number) {
    const a = s.accel;
    if (this.lastAccel) {
      const d = Math.hypot(a.x - this.lastAccel.x, a.y - this.lastAccel.y, a.z - this.lastAccel.z);
      const decay = Math.pow(0.5, Math.max(0, now - this.lastT) / 60); // half-life 60 ms
      this.jolt = Math.max(this.jolt * decay, d);
    }
    this.lastAccel = { ...a };
    this.lastT = now;
  }

  /** Current jolt-based velocity (1..127). */
  joltVelocity(): number {
    return Math.round(clamp(20 + (this.jolt / 1.2) * 107, 1, 127));
  }

  private gateOn(id: MappableInput, hasMotion: boolean) {
    const m: Mapping = this.preset.map[id];
    if (!this.inputOn || (this.solo != null && this.solo !== id)) return;
    if (m.type !== 'note') return;
    const velocity =
      this.preset.velocityFromMotion && hasMotion ? this.joltVelocity() : clamp(Math.round(m.velocity), 1, 127);
    this.midi.send([0x90 | (m.channel - 1), m.note & 0x7f, velocity]);
    this.held.set(id, { note: m.note, channel: m.channel });
    this.onNote?.({ input: id, note: m.note, velocity, channel: m.channel, on: true });
  }

  private gateOff(id: MappableInput) {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    this.noteOff(id, h.note, h.channel);
  }

  private noteOff(input: MappableInput, note: number, channel: number) {
    this.midi.send([0x80 | (channel - 1), note & 0x7f, 0]);
    this.onNote?.({ input, note, velocity: 0, channel, on: false });
  }
}
