/**
 * Gamepad API fallback: works without any permission prompt, but only provides buttons,
 * sticks and triggers (no gyro, touchpad positions or output). Used until WebHID is connected.
 */
import { emptyState, type ButtonId, type ControllerState } from './state';

// Standard Gamepad mapping indices.
const BUTTON_INDEX: [ButtonId, number][] = [
  ['cross', 0], ['circle', 1], ['square', 2], ['triangle', 3],
  ['l1', 4], ['r1', 5], ['l2', 6], ['r2', 7],
  ['create', 8], ['options', 9], ['l3', 10], ['r3', 11],
  ['up', 12], ['down', 13], ['left', 14], ['right', 15],
  ['ps', 16], ['touchpad', 17],
];

export class GamepadFallback {
  private timer: number | null = null;
  private index: number | null = null;
  name: string | null = null;

  constructor(
    private onState: (s: ControllerState) => void,
    private onConnection: (connected: boolean, name?: string) => void,
  ) {}

  static get supported() {
    return typeof navigator !== 'undefined' && 'getGamepads' in navigator;
  }

  start() {
    if (!GamepadFallback.supported || this.timer != null) return;
    window.addEventListener('gamepadconnected', () => this.poll());
    window.addEventListener('gamepaddisconnected', () => this.poll());
    this.timer = window.setInterval(() => this.poll(), 4);
  }

  private poll() {
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    if (this.index != null) pad = pads[this.index] ?? null;
    if (!pad) {
      pad = Array.from(pads).find((p): p is Gamepad => !!p && p.connected) ?? null;
      if (pad) {
        this.index = pad.index;
        this.name = pad.id;
        this.onConnection(true, pad.id);
      } else if (this.index != null) {
        this.index = null;
        this.name = null;
        this.onConnection(false);
      }
    }
    if (!pad) return;
    this.onState(toState(pad));
  }
}

export function toState(pad: Gamepad): ControllerState {
  const s = emptyState();
  for (const [id, i] of BUTTON_INDEX) s.buttons[id] = !!pad.buttons[i]?.pressed;
  s.sticks.lx = pad.axes[0] ?? 0;
  s.sticks.ly = pad.axes[1] ?? 0;
  s.sticks.rx = pad.axes[2] ?? 0;
  s.sticks.ry = pad.axes[3] ?? 0;
  s.triggers.l2 = pad.buttons[6]?.value ?? 0;
  s.triggers.r2 = pad.buttons[7]?.value ?? 0;
  return s;
}
