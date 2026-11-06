import { beforeEach, describe, expect, it } from 'vitest';
import { MotionTracker } from '../src/input/motion';
import { emptyState } from '../src/input/state';
import { MappingEngine, shapeValue } from '../src/mapping/engine';
import { defaultBank, defaultPreset, sanitizeBank } from '../src/mapping/presets';
import { noteName, parseNote } from '../src/midi/midi-out';

class Sink {
  msgs: number[][] = [];
  send(b: number[]) {
    this.msgs.push(b);
  }
}

describe('MappingEngine', () => {
  let sink: Sink;
  let engine: MappingEngine;
  const motion = new MotionTracker();
  let t = 0;
  const step = (s = emptyState()) => engine.process(s, motion, (t += 20));

  beforeEach(() => {
    sink = new Sink();
    engine = new MappingEngine(sink, defaultPreset(0));
    step();
    sink.msgs = [];
  });

  it('sends note on/off on button edges only (P1: up = C1 = 36)', () => {
    const s = emptyState();
    s.buttons.up = true;
    step(s);
    step(s);
    expect(sink.msgs).toEqual([[0x90, 36, 100]]);
    step(emptyState());
    expect(sink.msgs[1]).toEqual([0x80, 36, 0]);
  });

  it('uses the preset channel (P3 → channel 3)', () => {
    engine.setPreset(defaultPreset(2));
    const s = emptyState();
    s.buttons.cross = true;
    step(s);
    expect(sink.msgs).toContainEqual([0x92, 42, 100]);
  });

  it('sends CCs only when the value changes', () => {
    const s = emptyState();
    s.triggers.r2 = 1;
    step(s);
    step(s);
    const r2 = sink.msgs.filter((m) => m[0] === 0xb0 && m[1] === 25);
    expect(r2).toEqual([[0xb0, 25, 127]]);
  });

  it('inverts stick Y so pushing up yields a high value', () => {
    const s = emptyState();
    s.sticks.ly = -1;
    step(s);
    expect(sink.msgs.find((m) => m[1] === 21)).toEqual([0xb0, 21, 127]);
  });

  it('releases held notes when the preset changes', () => {
    const s = emptyState();
    s.buttons.l1 = true;
    step(s);
    engine.setPreset(defaultPreset(1));
    expect(sink.msgs.at(-1)).toEqual([0x80, 44, 0]);
  });

  it('respects input off and solo', () => {
    engine.inputOn = false;
    const s = emptyState();
    s.buttons.up = true;
    s.triggers.l2 = 0.5;
    step(s);
    expect(sink.msgs).toEqual([]);
    engine.inputOn = true;
    engine.solo = 'l2Analog';
    step(emptyState());
    s.buttons.down = true;
    step(s);
    expect(sink.msgs.every((m) => m[0] === 0xb0 && m[1] === 24)).toBe(true);
  });

  it('gates motion axes by motionOn and hasMotion', () => {
    const s = emptyState();
    s.hasMotion = true;
    s.accel = { x: 0, y: 1, z: 0 };
    engine.motionOn = false;
    step(s);
    expect(sink.msgs.some((m) => m[1] === 26)).toBe(false);
    engine.motionOn = true;
    step(s);
    expect(sink.msgs.some((m) => m[1] === 26)).toBe(true);
  });

  it('touch gates fire notes and touch axes hold their last value', () => {
    const s = emptyState();
    s.hasMotion = true;
    s.touch[0] = { active: true, id: 0, x: 1, y: 0 };
    step(s);
    expect(sink.msgs).toContainEqual([0x90, 52, 100]);
    expect(sink.msgs).toContainEqual([0xb0, 102, 127]);
    const up = emptyState();
    up.hasMotion = true;
    step(up);
    expect(sink.msgs).toContainEqual([0x80, 52, 0]);
    expect(engine.values.t1x).toBe(1);
  });

  it('sends pitch bend for a pitchbend mapping', () => {
    const p = defaultPreset(0);
    p.map.lx = { type: 'pitchbend', channel: 1, invert: false };
    engine.setPreset(p);
    const s = emptyState();
    s.sticks.lx = 1;
    step(s);
    expect(sink.msgs).toContainEqual([0xe0, 0x7f, 0x7f]);
  });
});

describe('shapeValue', () => {
  it('maps bipolar and unipolar ranges with curves', () => {
    expect(shapeValue(0, true, false, 'linear')).toBe(0.5);
    expect(shapeValue(-1, true, true, 'linear')).toBe(1);
    expect(shapeValue(0.5, false, false, 'exp')).toBe(0.25);
    expect(shapeValue(0.25, false, false, 'log')).toBe(0.5);
  });
});

describe('note names', () => {
  it('uses the Ableton convention', () => {
    expect(noteName(36)).toBe('C1');
    expect(noteName(44)).toBe('G#1');
    expect(noteName(0)).toBe('C-2');
    expect(parseNote('F#1')).toBe(42);
    expect(parseNote('c3')).toBe(60);
    expect(parseNote('Db1')).toBe(37);
    expect(parseNote('127')).toBe(127);
    expect(parseNote('X9')).toBeNull();
  });
});

describe('preset bank', () => {
  it('repairs partial or broken imported data', () => {
    const bank = sanitizeBank({ active: 2, presets: [{ name: 'Mine', map: { up: { type: 'note', note: 60 } } }, null] });
    expect(bank.active).toBe(2);
    expect(bank.presets).toHaveLength(4);
    expect(bank.presets[0].name).toBe('Mine');
    expect(bank.presets[0].map.up).toMatchObject({ type: 'note', note: 60, velocity: 100, channel: 1 });
    expect(bank.presets[0].map.down).toEqual(defaultBank().presets[0].map.down);
    expect(sanitizeBank('garbage').active).toBe(0);
  });
});
