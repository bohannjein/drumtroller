/** Web MIDI output with automatic port selection. */

export interface MidiSink {
  send(bytes: number[]): void;
}

const PORT_KEY = 'drumtroller.midiPort';

export class MidiOut implements MidiSink {
  private access: MIDIAccess | null = null;
  private port: MIDIOutput | null = null;
  error: string | null = null;
  /** Called for every message sent (for the UI's activity LED). */
  onSend: ((bytes: number[]) => void) | null = null;
  onPortsChanged: (() => void) | null = null;

  static get supported() {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async init() {
    if (!MidiOut.supported) {
      this.error = 'Web MIDI wird von diesem Browser nicht unterstützt';
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      this.error = 'MIDI-Zugriff verweigert';
      console.warn('[drumtroller] MIDI access failed', err);
      return;
    }
    this.access.onstatechange = () => {
      if (!this.port || this.port.state === 'disconnected') this.autoSelect();
      this.onPortsChanged?.();
    };
    this.autoSelect();
  }

  get outputs(): MIDIOutput[] {
    return this.access ? Array.from(this.access.outputs.values()) : [];
  }

  get current(): MIDIOutput | null {
    return this.port;
  }

  select(id: string) {
    this.port = this.outputs.find((o) => o.id === id) ?? null;
    try {
      if (this.port) localStorage.setItem(PORT_KEY, this.port.name ?? '');
    } catch {
      /* storage unavailable */
    }
    this.onPortsChanged?.();
  }

  private autoSelect() {
    const outs = this.outputs.filter((o) => o.state !== 'disconnected');
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(PORT_KEY);
    } catch {
      /* storage unavailable */
    }
    this.port =
      outs.find((o) => saved && o.name === saved) ??
      // Prefer virtual loopback ports that a DAW typically listens to.
      outs.find((o) => /iac|loopmidi|virtual|drumtroller|midi through/i.test(o.name ?? '')) ??
      outs[0] ??
      null;
  }

  send(bytes: number[]) {
    if (!this.port) return;
    try {
      this.port.send(bytes);
    } catch (err) {
      console.warn('[drumtroller] MIDI send failed', err);
    }
    this.onSend?.(bytes);
  }
}

// ---------------------------------------------------------------------------
// Note names (Ableton convention: C3 = 60, C-2 = 0, Drum Rack starts at C1 = 36)
// ---------------------------------------------------------------------------

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function noteName(n: number): string {
  return NAMES[n % 12] + (Math.floor(n / 12) - 2);
}

/** Parses "C1", "f#2", "Db-1" or a plain number. Returns null if invalid. */
export function parseNote(text: string): number | null {
  const t = text.trim();
  if (/^\d{1,3}$/.test(t)) {
    const n = Number(t);
    return n <= 127 ? n : null;
  }
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(t);
  if (!m) return null;
  let pc = NAMES.indexOf(m[1].toUpperCase());
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  const n = (Number(m[3]) + 2) * 12 + pc;
  return n >= 0 && n <= 127 ? n : null;
}
