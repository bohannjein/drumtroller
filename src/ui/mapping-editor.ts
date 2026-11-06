/** "Playlist"-style mapping editor plus the quick slot lists beside the controller. */
import { AXIS_LABELS, BUTTON_LABELS, TOUCH_GATE_LABELS, type InputId } from '../input/state';
import { noteName, parseNote } from '../midi/midi-out';
import {
  GATE_INPUTS,
  defaultMappingFor,
  isGate,
  type Mapping,
  type MappableInput,
  type MappingType,
  type Preset,
} from '../mapping/presets';

export function inputLabel(id: InputId): string {
  return (
    (BUTTON_LABELS as Record<string, string>)[id] ??
    (AXIS_LABELS as Record<string, string>)[id] ??
    (TOUCH_GATE_LABELS as Record<string, string>)[id] ??
    id
  );
}

export function mappingSummary(m: Mapping): string {
  switch (m.type) {
    case 'off':
      return '---';
    case 'note':
      return noteName(m.note);
    case 'cc':
      return `CC${m.cc}`;
    case 'pitchbend':
      return 'BEND';
  }
}

const GROUPS: { title: string; ids: MappableInput[] }[] = [
  { title: 'BUTTONS', ids: GATE_INPUTS.filter((g) => g !== 'touch1' && g !== 'touch2') },
  { title: 'TOUCHPAD', ids: ['touch1', 'touch2', 't1x', 't1y', 't2x', 't2y'] },
  { title: 'STICKS + TRIGGER', ids: ['lx', 'ly', 'rx', 'ry', 'l2Analog', 'r2Analog'] },
  { title: 'MOTION', ids: ['pitch', 'roll', 'yaw', 'accX', 'accY', 'accZ'] },
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

function select(options: [string, string][], value: string, cls = 'pl-in') {
  const s = el('select', cls);
  for (const [v, label] of options) {
    const o = el('option', undefined, label);
    o.value = v;
    s.append(o);
  }
  s.value = value;
  return s;
}

function numberInput(value: number, min: number, max: number, cls = 'pl-in pl-num') {
  const i = el('input', cls);
  i.type = 'number';
  i.min = String(min);
  i.max = String(max);
  i.value = String(value);
  return i;
}

const CHANNELS: [string, string][] = Array.from({ length: 16 }, (_, i) => [String(i + 1), `CH${i + 1}`]);

export class MappingEditor {
  private rows = new Map<MappableInput, HTMLElement>();
  private selected: MappableInput | null = null;
  soloId: MappableInput | null = null;

  onChange: ((id: MappableInput, m: Mapping) => void) | null = null;
  onSolo: ((id: MappableInput | null) => void) | null = null;

  constructor(
    private host: HTMLElement,
    private getPreset: () => Preset,
    private defaultChannel: () => number,
  ) {}

  build() {
    this.host.innerHTML = '';
    this.rows.clear();
    let n = 1;
    for (const g of GROUPS) {
      this.host.append(el('div', 'pl-group', g.title));
      for (const id of g.ids) {
        const row = el('div', 'pl-row');
        row.dataset.input = id;
        this.rows.set(id, row);
        this.fillRow(row, id, n++);
        row.addEventListener('mousedown', () => this.select(id, false));
        this.host.append(row);
      }
    }
    if (this.selected) this.select(this.selected, false);
  }

  private fillRow(row: HTMLElement, id: MappableInput, index: number) {
    row.innerHTML = '';
    const m = this.getPreset().map[id];
    row.append(el('span', 'pl-idx', `${String(index).padStart(2, '0')}.`));
    row.append(el('span', 'pl-name', inputLabel(id)));

    const types: [string, string][] = isGate(id)
      ? [['note', 'NOTE'], ['off', 'OFF']]
      : [['cc', 'CC'], ['pitchbend', 'P.BEND'], ['off', 'OFF']];
    const typeSel = select(types, m.type);
    typeSel.title = 'Typ';
    typeSel.addEventListener('change', () => {
      const channel = 'channel' in m ? m.channel : this.defaultChannel();
      this.commit(id, defaultMappingFor(id, typeSel.value as MappingType, channel), row, index);
    });
    row.append(typeSel);

    const fields = el('span', 'pl-fields');
    row.append(fields);

    if (m.type === 'note') {
      const note = el('input', 'pl-in pl-note');
      note.value = noteName(m.note);
      note.title = 'Note (z. B. C1, F#2 oder 36)';
      note.addEventListener('change', () => {
        const v = parseNote(note.value);
        if (v == null) {
          note.value = noteName(m.note);
          return;
        }
        this.commit(id, { ...m, note: v }, row, index);
      });
      const vel = numberInput(m.velocity, 1, 127);
      vel.title = 'Velocity';
      vel.addEventListener('change', () => this.commit(id, { ...m, velocity: clampNum(vel.value, 1, 127, m.velocity) }, row, index));
      fields.append(note, el('span', 'pl-lbl', 'VEL'), vel, this.channelSelect(m, id, row, index));
    } else if (m.type === 'cc') {
      const cc = numberInput(m.cc, 0, 127);
      cc.title = 'CC-Nummer';
      cc.addEventListener('change', () => this.commit(id, { ...m, cc: clampNum(cc.value, 0, 127, m.cc) }, row, index));
      const curve = select([['linear', 'LIN'], ['exp', 'EXP'], ['log', 'LOG']], m.curve);
      curve.title = 'Kurve';
      curve.addEventListener('change', () => this.commit(id, { ...m, curve: curve.value as typeof m.curve }, row, index));
      const min = numberInput(m.min, 0, 127);
      min.title = 'Minimum';
      min.addEventListener('change', () => this.commit(id, { ...m, min: clampNum(min.value, 0, 127, m.min) }, row, index));
      const max = numberInput(m.max, 0, 127);
      max.title = 'Maximum';
      max.addEventListener('change', () => this.commit(id, { ...m, max: clampNum(max.value, 0, 127, m.max) }, row, index));
      fields.append(
        el('span', 'pl-lbl', 'CC'), cc,
        this.channelSelect(m, id, row, index),
        curve,
        this.invertToggle(m, id, row, index),
        el('span', 'pl-lbl', 'RNG'), min, max,
      );
    } else if (m.type === 'pitchbend') {
      fields.append(this.channelSelect(m, id, row, index), this.invertToggle(m, id, row, index));
    }

    const solo = el('button', 'pl-solo', 'SOLO');
    solo.type = 'button';
    solo.title = 'Nur dieses Input senden – zum MIDI-Learn in der DAW';
    solo.classList.toggle('on', this.soloId === id);
    solo.addEventListener('click', (e) => {
      e.stopPropagation();
      this.soloId = this.soloId === id ? null : id;
      this.rows.forEach((r, rid) => r.querySelector('.pl-solo')?.classList.toggle('on', rid === this.soloId));
      this.onSolo?.(this.soloId);
    });
    row.append(el('span', 'pl-val', ''), solo);
  }

  private channelSelect(m: Extract<Mapping, { channel: number }>, id: MappableInput, row: HTMLElement, index: number) {
    const ch = select(CHANNELS, String(m.channel));
    ch.title = 'MIDI-Kanal';
    ch.addEventListener('change', () => this.commit(id, { ...m, channel: Number(ch.value) }, row, index));
    return ch;
  }

  private invertToggle(m: Extract<Mapping, { invert: boolean }>, id: MappableInput, row: HTMLElement, index: number) {
    const b = el('button', 'pl-tog', 'INV');
    b.type = 'button';
    b.title = 'Richtung umkehren';
    b.classList.toggle('on', m.invert);
    b.addEventListener('click', () => this.commit(id, { ...m, invert: !m.invert }, row, index));
    return b;
  }

  private commit(id: MappableInput, m: Mapping, row: HTMLElement, index: number) {
    this.onChange?.(id, m);
    this.fillRow(row, id, index);
  }

  select(id: MappableInput, scroll = true) {
    this.selected = id;
    this.rows.forEach((r, rid) => r.classList.toggle('sel', rid === id));
    if (scroll) this.rows.get(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Live activity: highlight rows whose input is active and show the value being sent. */
  renderLive(gates: Record<string, boolean>, sent: Record<string, number | null>) {
    for (const [id, row] of this.rows) {
      const on = gates[id] ?? false;
      row.classList.toggle('live', on);
      if (id in sent) {
        const v = sent[id];
        const out = row.querySelector('.pl-val');
        const text = v == null ? '' : String(v).padStart(3, '0');
        if (out && out.textContent !== text) out.textContent = text;
      }
    }
  }
}

function clampNum(text: string, lo: number, hi: number, fallback: number) {
  const n = Math.round(Number(text));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

/** The two short slot lists left/right of the controller, as in the reference device. */
export class QuickSlots {
  static LEFT: MappableInput[] = ['l1', 'up', 'down', 'left', 'right'];
  static RIGHT: MappableInput[] = ['r1', 'triangle', 'square', 'circle', 'cross'];
  private slots = new Map<MappableInput, HTMLElement>();

  constructor(
    left: HTMLElement,
    right: HTMLElement,
    private onPick: (id: MappableInput) => void,
  ) {
    this.build(left, QuickSlots.LEFT);
    this.build(right, QuickSlots.RIGHT);
  }

  private build(host: HTMLElement, ids: MappableInput[]) {
    host.innerHTML = '';
    for (const id of ids) {
      const b = el('button', 'qs-slot');
      b.type = 'button';
      b.title = 'Mapping bearbeiten';
      b.append(el('span', 'qs-key', inputLabel(id)), el('span', 'qs-val', ''));
      b.addEventListener('click', () => this.onPick(id));
      host.append(b);
      this.slots.set(id, b);
    }
  }

  update(p: Preset) {
    for (const [id, b] of this.slots) b.querySelector('.qs-val')!.textContent = mappingSummary(p.map[id]);
  }

  renderLive(gates: Record<string, boolean>) {
    for (const [id, b] of this.slots) b.classList.toggle('on', !!gates[id]);
  }
}
