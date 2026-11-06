import './styles/skins.css';
import './styles/base.css';

import { DualSenseHID } from './input/dualsense-hid';
import { PLAYER_LED_PATTERNS, defaultOutput, type OutputState } from './input/dualsense-report';
import { GamepadFallback } from './input/gamepad-fallback';
import { MotionTracker } from './input/motion';
import { emptyState, type ButtonId, type ControllerState } from './input/state';
import { MappingEngine, type NoteEvent } from './mapping/engine';
import {
  MAPPABLE_INPUTS,
  SYSTEM_BUTTONS,
  defaultPreset,
  loadBank,
  sanitizeBank,
  saveBank,
  type MappableInput,
  type Preset,
} from './mapping/presets';
import { MidiOut, noteName } from './midi/midi-out';
import {
  SKINS,
  hexToRgb,
  loadSettings,
  rgbToHex,
  saveSettings,
  triggerEffect,
  type SkinId,
  type TriggerMode,
} from './settings';
import { Analyzer, GyroRadar } from './ui/analyzer';
import { ControllerView } from './ui/controller-view';
import { MappingEditor, QuickSlots, inputLabel } from './ui/mapping-editor';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const bank = loadBank();
const settings = loadSettings();
const preset = (): Preset => bank.presets[bank.active];

const midi = new MidiOut();
const motion = new MotionTracker();
const engine = new MappingEngine(midi, preset());
engine.inputOn = settings.inputOn;
engine.motionOn = settings.motionOn;

let current: ControllerState = emptyState();
let padName: string | null = null;
let hidInfo: { name: string; transport: string } | null = null;
let rumbleUntil = 0;
let lastNote: NoteEvent | null = null;
let midiBlinkUntil = 0;

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------

document.body.dataset.skin = settings.skin;

const view = new ControllerView($('controller'));
const analyzer = new Analyzer($<HTMLCanvasElement>('analyzer'));
const radar = new GyroRadar(
  document.getElementById('radarDot') as unknown as SVGCircleElement,
  document.getElementById('radarNeedle') as unknown as SVGLineElement,
);
const editor = new MappingEditor($('mapList'), preset, () => bank.active + 1);
const slots = new QuickSlots($('slotsLeft'), $('slotsRight'), (id) => openMapping(id));

editor.onChange = (id, m) => {
  preset().map[id] = m;
  saveBank(bank);
  engine.resync();
  slots.update(preset());
};
editor.onSolo = (id) => {
  engine.allNotesOff();
  engine.solo = id;
  engine.resync();
  updateTicker();
};
engine.onNote = (e) => {
  if (e.on) {
    lastNote = e;
    if (settings.rumbleOnHit) {
      rumbleUntil = performance.now() + 70;
      pushOutput();
      setTimeout(pushOutput, 80);
    }
  }
};
midi.onSend = () => {
  midiBlinkUntil = performance.now() + 60;
};

view.onPartClick((id) => {
  if ((MAPPABLE_INPUTS as string[]).includes(id)) openMapping(id as MappableInput);
});

// ---------------------------------------------------------------------------
// Skins
// ---------------------------------------------------------------------------

const skinHost = $('skinButtons');
for (const s of SKINS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'skin-dot';
  b.dataset.skin = s.id;
  b.title = `Skin: ${s.label}`;
  b.setAttribute('aria-label', `Skin ${s.label}`);
  b.addEventListener('click', () => setSkin(s.id));
  skinHost.append(b);
}
function setSkin(id: SkinId) {
  settings.skin = id;
  document.body.dataset.skin = id;
  skinHost.querySelectorAll<HTMLElement>('.skin-dot').forEach((b) => b.classList.toggle('on', b.dataset.skin === id));
  saveSettings(settings);
  requestAnimationFrame(() => analyzer.readColors());
}
setSkin(settings.skin);

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const presetKeys = Array.from(document.querySelectorAll<HTMLButtonElement>('#presetKeys .hw-key'));
presetKeys.forEach((k) => k.addEventListener('click', () => setPreset(Number(k.dataset.preset))));

function setPreset(i: number) {
  bank.active = ((i % 4) + 4) % 4;
  saveBank(bank);
  engine.setPreset(preset());
  presetKeys.forEach((k, idx) => k.classList.toggle('on', idx === bank.active));
  $('lcdPreset').textContent = preset().name;
  $('mapTitle').textContent = `MAPPINGS · ${preset().name}`;
  $('drumMode').classList.toggle('on', preset().velocityFromMotion);
  slots.update(preset());
  editor.build();
  syncFxControls();
  pushOutput();
}

// ---------------------------------------------------------------------------
// Controller output (lightbar, LEDs, rumble, triggers)
// ---------------------------------------------------------------------------

let lastOutputKey = '';
function buildOutput(): OutputState {
  const out = defaultOutput();
  out.lightbar = settings.lightbarFollowsPreset ? preset().color : hexToRgb(settings.lightbarColor);
  out.playerLeds = PLAYER_LED_PATTERNS[bank.active];
  out.muteLed = !settings.motionOn;
  const rumble = performance.now() < rumbleUntil ? 200 : 0;
  out.rumbleLeft = rumble;
  out.rumbleRight = rumble;
  out.l2Effect = triggerEffect(settings.l2Mode, settings.l2Strength);
  out.r2Effect = triggerEffect(settings.r2Mode, settings.r2Strength);
  return out;
}
function pushOutput(force = false) {
  if (!hid.connected) return;
  const out = buildOutput();
  const key = JSON.stringify(out);
  if (!force && key === lastOutputKey) return;
  lastOutputKey = key;
  hid.setOutput(out);
}

// ---------------------------------------------------------------------------
// Input handling
// ---------------------------------------------------------------------------

const prevSystem: Partial<Record<ButtonId, boolean>> = {};

function handleState(s: ControllerState, from: 'hid' | 'pad') {
  if (from === 'pad' && hid.connected) return; // WebHID wins when available
  const now = performance.now();
  motion.update(s, now);

  // System buttons (edge-triggered)
  for (const b of Object.keys(SYSTEM_BUTTONS) as ButtonId[]) {
    const pressed = s.buttons[b];
    if (pressed && !prevSystem[b]) {
      if (b === 'ps') setPreset(bank.active + 1);
      else if (b === 'mute') setMotion(!settings.motionOn);
      else if (b === 'create') motion.recenter();
    }
    prevSystem[b] = pressed;
  }

  // While the mapping drawer is open, pressing a button jumps to its row.
  if (!$('mapDrawer').hidden) {
    for (const id of MAPPABLE_INPUTS) {
      const isPressed = (s.buttons as Record<string, boolean>)[id];
      if (isPressed && !current.buttons[id as ButtonId]) editor.select(id);
    }
  }

  engine.process(s, motion, now);
  current = s;
}

const hid = new DualSenseHID({
  onState: (s) => handleState(s, 'hid'),
  onConnection: (connected, info) => {
    hidInfo = connected && info ? info : null;
    $('connectBtn').classList.toggle('connected', connected);
    $('connectLabel').textContent = connected ? 'LINKED' : 'CONNECT';
    if (connected) {
      lastOutputKey = '';
      pushOutput(true);
    } else {
      engine.allNotesOff();
      current = emptyState();
    }
    updateTicker();
  },
});

const pad = new GamepadFallback(
  (s) => handleState(s, 'pad'),
  (connected, name) => {
    padName = connected ? name ?? 'Gamepad' : null;
    if (!connected && !hid.connected) {
      engine.allNotesOff();
      current = emptyState();
    }
    updateTicker();
  },
);

// ---------------------------------------------------------------------------
// Toggles and deck
// ---------------------------------------------------------------------------

function setInput(on: boolean) {
  settings.inputOn = on;
  engine.inputOn = on;
  if (!on) engine.allNotesOff();
  engine.resync();
  saveSettings(settings);
  $('inputToggle').classList.toggle('on', on);
  $('inputToggle').textContent = on ? 'INPUT ON' : 'INPUT OFF';
}
function setMotion(on: boolean) {
  settings.motionOn = on;
  engine.motionOn = on;
  engine.resync();
  saveSettings(settings);
  $('motionToggle').classList.toggle('on', on);
  $('motionToggle').textContent = on ? 'MOTION ON' : 'MOTION OFF';
  pushOutput();
}
$('inputToggle').addEventListener('click', () => setInput(!settings.inputOn));
$('motionToggle').addEventListener('click', () => setMotion(!settings.motionOn));
$('recenterBtn').addEventListener('click', () => motion.recenter());
$('drumMode').addEventListener('click', () => {
  preset().velocityFromMotion = !preset().velocityFromMotion;
  saveBank(bank);
  $('drumMode').classList.toggle('on', preset().velocityFromMotion);
});

$('connectBtn').addEventListener('click', async () => {
  if (!DualSenseHID.supported) {
    showBrowserWarning();
    return;
  }
  try {
    await hid.request();
  } catch (err) {
    console.warn('[drumtroller] connect cancelled', err);
  }
});

document.querySelectorAll<HTMLButtonElement>('.drawer-btn').forEach((b) => {
  b.addEventListener('click', () => toggleDrawer(b.dataset.drawer!));
});
function toggleDrawer(id: string, force?: boolean) {
  const d = $(id);
  const open = force ?? d.hidden;
  d.hidden = !open;
  document.querySelector(`.drawer-btn[data-drawer="${id}"]`)?.classList.toggle('on', open);
}
function openMapping(id: MappableInput) {
  toggleDrawer('mapDrawer', true);
  editor.select(id);
}

// MIDI port select
const midiSelect = $<HTMLSelectElement>('midiSelect');
function refreshMidiPorts() {
  midiSelect.innerHTML = '';
  const outs = midi.outputs;
  if (!outs.length) {
    const o = document.createElement('option');
    o.textContent = midi.error ?? 'KEIN MIDI-PORT';
    midiSelect.append(o);
    midiSelect.disabled = true;
  } else {
    midiSelect.disabled = false;
    for (const out of outs) {
      const o = document.createElement('option');
      o.value = out.id;
      o.textContent = out.name ?? out.id;
      midiSelect.append(o);
    }
    if (midi.current) midiSelect.value = midi.current.id;
  }
  $('lcdMidi').textContent = `MIDI ${midi.current?.name?.toUpperCase().slice(0, 18) ?? '--'}`;
  updateTicker();
}
midiSelect.addEventListener('change', () => midi.select(midiSelect.value));
midi.onPortsChanged = refreshMidiPorts;

// Export / import / reset
$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(bank, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'drumtroller-presets.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$<HTMLInputElement>('importInput').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const imported = sanitizeBank(JSON.parse(await file.text()));
    bank.presets = imported.presets;
    setPreset(imported.active);
  } catch {
    alert('Diese Datei ist kein gültiges Drumtroller-Preset.');
  }
});
$('resetBtn').addEventListener('click', () => {
  if (!confirm(`${preset().name} auf Standard zurücksetzen?`)) return;
  bank.presets[bank.active] = defaultPreset(bank.active);
  setPreset(bank.active);
});

// FX drawer
const lbFollow = $<HTMLInputElement>('lbFollow');
const lbColor = $<HTMLInputElement>('lbColor');
const rumbleHit = $<HTMLInputElement>('rumbleHit');
const trig = {
  l2: { mode: $<HTMLSelectElement>('l2Mode'), strength: $<HTMLInputElement>('l2Strength') },
  r2: { mode: $<HTMLSelectElement>('r2Mode'), strength: $<HTMLInputElement>('r2Strength') },
};
function syncFxControls() {
  lbFollow.checked = settings.lightbarFollowsPreset;
  lbColor.value = settings.lightbarFollowsPreset ? rgbToHex(preset().color) : settings.lightbarColor;
  rumbleHit.checked = settings.rumbleOnHit;
  trig.l2.mode.value = settings.l2Mode;
  trig.l2.strength.value = String(settings.l2Strength);
  trig.r2.mode.value = settings.r2Mode;
  trig.r2.strength.value = String(settings.r2Strength);
}
lbFollow.addEventListener('change', () => {
  settings.lightbarFollowsPreset = lbFollow.checked;
  saveSettings(settings);
  syncFxControls();
  pushOutput();
});
lbColor.addEventListener('input', () => {
  if (settings.lightbarFollowsPreset) {
    // Editing the colour while following the preset recolours the preset itself.
    preset().color = hexToRgb(lbColor.value);
    saveBank(bank);
  } else {
    settings.lightbarColor = lbColor.value;
    saveSettings(settings);
  }
  pushOutput();
});
rumbleHit.addEventListener('change', () => {
  settings.rumbleOnHit = rumbleHit.checked;
  saveSettings(settings);
});
$('rumbleTest').addEventListener('click', () => {
  rumbleUntil = performance.now() + 400;
  pushOutput();
  setTimeout(pushOutput, 420);
});
for (const side of ['l2', 'r2'] as const) {
  const onChange = () => {
    settings[`${side}Mode`] = trig[side].mode.value as TriggerMode;
    settings[`${side}Strength`] = Number(trig[side].strength.value);
    saveSettings(settings);
    pushOutput();
  };
  trig[side].mode.addEventListener('change', onChange);
  trig[side].strength.addEventListener('input', onChange);
}

// ---------------------------------------------------------------------------
// LCD + ticker
// ---------------------------------------------------------------------------

function showBrowserWarning() {
  const w = $('browserWarn');
  w.hidden = false;
  w.textContent =
    'Dieser Browser kann kein WebHID. Tasten und Sticks gehen trotzdem, für Gyro, Touchpad und Lightbar bitte Chrome oder Edge am Desktop nutzen.';
}

function updateTicker() {
  let msg: string;
  if (hid.connected) {
    msg = `${(hidInfo?.name ?? 'DUALSENSE').toUpperCase()} VIA ${hidInfo?.transport === 'bt' ? 'BLUETOOTH' : 'USB'} · GYRO + TOUCHPAD AKTIV`;
  } else if (padName) {
    msg = 'NUR TASTEN + STICKS · CONNECT DRÜCKEN FÜR GYRO, TOUCHPAD UND LIGHTBAR';
  } else {
    msg = 'DUALSENSE PER USB ODER BLUETOOTH ANSCHLIESSEN · DANN CONNECT DRÜCKEN';
  }
  if (!midi.current) msg += ' · KEIN MIDI-PORT: IAC (MAC) ODER LOOPMIDI (WIN) EINRICHTEN, SIEHE HILFE';
  else msg += ` · MIDI → ${midi.current.name?.toUpperCase()}`;
  if (engine.solo) msg = `SOLO: ${inputLabel(engine.solo)} · NUR DIESES INPUT SENDET · ` + msg;
  const t = $('ticker');
  if (t.textContent !== msg) t.textContent = msg;

  const dev = $('stDevice');
  const dot = $('statusDot');
  dot.className = 'status-dot' + (hid.connected ? ' hid' : padName ? ' pad' : '');
  dev.textContent = hid.connected ? 'DUALSENSE · HID' : padName ? 'GAMEPAD · BASIC' : 'KEIN CONTROLLER';
  $('lcdConn').textContent = hid.connected
    ? `${hidInfo?.transport === 'bt' ? 'BT' : 'USB'} LINK OK`
    : padName
      ? 'BASIC MODE'
      : 'NO CTRL';
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

let lastBattery = '';
let lastNoteText = '';
function frame() {
  const s = current;
  const lightbar = buildOutput().lightbar;
  view.render(s, lightbar, !settings.motionOn);
  analyzer.render(engine.values, engine.sent);
  radar.render(engine.values.pitch, engine.values.roll, engine.values.yaw);
  editor.renderLive(engine.gates, engine.sent);
  slots.renderLive(engine.gates);

  const batt = s.battery == null ? 'BAT --%' : `BAT ${String(s.battery).padStart(3, ' ')}%${s.charging ? '+' : ''}`;
  if (batt !== lastBattery) $('lcdBatt').textContent = lastBattery = batt;
  const noteText = lastNote ? `${noteName(lastNote.note).padEnd(3, ' ')} V${String(lastNote.velocity).padStart(3, '0')} CH${lastNote.channel}` : '-- ---';
  if (noteText !== lastNoteText) $('lcdNote').textContent = lastNoteText = noteText;
  $('midiLed').classList.toggle('on', performance.now() < midiBlinkUntil);
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

setPreset(bank.active);
setInput(settings.inputOn);
setMotion(settings.motionOn);
syncFxControls();
updateTicker();
requestAnimationFrame(frame);

if (!DualSenseHID.supported) showBrowserWarning();
pad.start();
void hid.init().then(updateTicker);
void midi.init().then(refreshMidiPorts);
