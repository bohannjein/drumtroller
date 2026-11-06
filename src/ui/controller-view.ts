/** Chrome-styled inline SVG of the controller that lights up with live input. */
import type { ControllerState } from '../input/state';

const SVG_NS = 'http://www.w3.org/2000/svg';

// An original, stylised controller silhouette (viewBox 0 0 420 270).
const BODY_PATH =
  'M120 38 C150 30 270 30 300 38 L338 46 C372 52 392 78 400 118 L414 196 C420 236 400 262 370 262 ' +
  'C344 262 330 246 318 222 L300 188 C292 176 282 172 268 172 L152 172 C138 172 128 176 120 188 ' +
  'L102 222 C90 246 76 262 50 262 C20 262 0 236 6 196 L20 118 C28 78 48 52 82 46 Z';

const TEMPLATE = `
<svg class="ds-svg" viewBox="0 -4 420 274" xmlns="${SVG_NS}" role="img" aria-label="Controller-Ansicht">
  <defs>
    <linearGradient id="dsChrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--chrome-hi)"/>
      <stop offset=".45" stop-color="var(--chrome-mid)"/>
      <stop offset=".55" stop-color="var(--chrome-lo)"/>
      <stop offset="1" stop-color="var(--chrome-mid)"/>
    </linearGradient>
    <linearGradient id="dsInset" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070c"/>
      <stop offset="1" stop-color="#1a2230"/>
    </linearGradient>
    <radialGradient id="dsKnob" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="var(--chrome-hi)"/>
      <stop offset=".6" stop-color="var(--chrome-lo)"/>
      <stop offset="1" stop-color="#0b0e14"/>
    </radialGradient>
    <filter id="dsGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- triggers + bumpers -->
  <g class="ds-trig">
    <rect x="70" y="0" width="70" height="20" rx="8" class="ds-part" data-btn="l2"/>
    <rect x="72" y="2" width="0" height="16" rx="6" class="ds-fill" data-fill="l2"/>
    <rect x="280" y="0" width="70" height="20" rx="8" class="ds-part" data-btn="r2"/>
    <rect x="282" y="2" width="0" height="16" rx="6" class="ds-fill" data-fill="r2"/>
    <rect x="74" y="23" width="64" height="16" rx="6" class="ds-part" data-btn="l1"/>
    <rect x="282" y="23" width="64" height="16" rx="6" class="ds-part" data-btn="r1"/>
    <text x="105" y="14" class="ds-tlabel">L2</text>
    <text x="315" y="14" class="ds-tlabel">R2</text>
    <text x="106" y="34" class="ds-tlabel">L1</text>
    <text x="314" y="34" class="ds-tlabel">R1</text>
  </g>

  <path d="${BODY_PATH}" class="ds-body"/>
  <path d="${BODY_PATH}" class="ds-body-shine"/>

  <!-- lightbar strips beside the touchpad -->
  <rect x="140" y="50" width="5" height="62" rx="2" class="ds-lightbar"/>
  <rect x="275" y="50" width="5" height="62" rx="2" class="ds-lightbar"/>

  <!-- touchpad -->
  <rect x="150" y="46" width="120" height="70" rx="10" class="ds-pad" data-btn="touchpad"/>
  <circle r="7" class="ds-finger" data-finger="0" cx="0" cy="0"/>
  <circle r="7" class="ds-finger f2" data-finger="1" cx="0" cy="0"/>

  <!-- create / options -->
  <rect x="122" y="54" width="8" height="18" rx="4" class="ds-part" data-btn="create"/>
  <rect x="290" y="54" width="8" height="18" rx="4" class="ds-part" data-btn="options"/>

  <!-- d-pad -->
  <g class="ds-dpad">
    <path d="M78 82 h16 v18 l-8 8 l-8 -8 z" class="ds-part" data-btn="up"/>
    <path d="M78 134 h16 v-18 l-8 -8 l-8 8 z" class="ds-part" data-btn="down"/>
    <path d="M60 100 v16 h18 l8 -8 l-8 -8 z" class="ds-part" data-btn="left"/>
    <path d="M112 100 v16 h-18 l-8 -8 l8 -8 z" class="ds-part" data-btn="right"/>
  </g>

  <!-- face buttons -->
  <g class="ds-face">
    <circle cx="334" cy="84" r="11" class="ds-part" data-btn="triangle"/>
    <path d="M334 77 l6 10 h-12 z" class="ds-sym"/>
    <circle cx="334" cy="132" r="11" class="ds-part" data-btn="cross"/>
    <path d="M329 127 l10 10 M339 127 l-10 10" class="ds-sym"/>
    <circle cx="310" cy="108" r="11" class="ds-part" data-btn="square"/>
    <rect x="305" y="103" width="10" height="10" class="ds-sym"/>
    <circle cx="358" cy="108" r="11" class="ds-part" data-btn="circle"/>
    <circle cx="358" cy="108" r="5.5" class="ds-sym"/>
  </g>

  <!-- sticks -->
  <circle cx="150" cy="150" r="24" class="ds-well" data-btn="l3"/>
  <circle cx="150" cy="150" r="15" class="ds-knob" data-stick="l"/>
  <circle cx="270" cy="150" r="24" class="ds-well" data-btn="r3"/>
  <circle cx="270" cy="150" r="15" class="ds-knob" data-stick="r"/>

  <!-- PS + mute -->
  <circle cx="210" cy="140" r="9" class="ds-part" data-btn="ps"/>
  <text x="210" y="143.5" class="ds-pslabel">PS</text>
  <rect x="200" y="158" width="20" height="6" rx="3" class="ds-part ds-mute" data-btn="mute"/>
</svg>`;

export class ControllerView {
  readonly el: HTMLElement;
  private parts = new Map<string, SVGElement[]>();
  private fills = new Map<string, SVGRectElement>();
  private knobs = new Map<string, SVGCircleElement>();
  private fingers: SVGCircleElement[] = [];
  private lightbars: SVGRectElement[] = [];

  constructor(host: HTMLElement) {
    host.innerHTML = TEMPLATE;
    this.el = host;
    host.querySelectorAll<SVGElement>('[data-btn]').forEach((n) => {
      const id = n.dataset.btn!;
      this.parts.set(id, [...(this.parts.get(id) ?? []), n]);
    });
    host.querySelectorAll<SVGRectElement>('[data-fill]').forEach((n) => this.fills.set(n.dataset.fill!, n));
    host.querySelectorAll<SVGCircleElement>('[data-stick]').forEach((n) => this.knobs.set(n.dataset.stick!, n));
    this.fingers = Array.from(host.querySelectorAll<SVGCircleElement>('[data-finger]'));
    this.lightbars = Array.from(host.querySelectorAll<SVGRectElement>('.ds-lightbar'));
  }

  /** Lets callers react to clicks on a button part (e.g. to open its mapping). */
  onPartClick(cb: (id: string) => void) {
    this.el.addEventListener('click', (e) => {
      const t = (e.target as Element).closest('[data-btn]') as SVGElement | null;
      if (t?.dataset.btn) cb(t.dataset.btn);
    });
  }

  render(s: ControllerState, lightbar: [number, number, number], muteLed: boolean) {
    for (const [id, nodes] of this.parts) {
      const on = s.buttons[id as keyof typeof s.buttons];
      for (const n of nodes) n.classList.toggle('on', !!on);
    }
    this.parts.get('mute')?.forEach((n) => n.classList.toggle('led', muteLed));
    this.setFill('l2', s.triggers.l2);
    this.setFill('r2', s.triggers.r2);
    this.moveKnob('l', 150, 150, s.sticks.lx, s.sticks.ly);
    this.moveKnob('r', 270, 150, s.sticks.rx, s.sticks.ry);
    s.touch.forEach((t, i) => {
      const f = this.fingers[i];
      f.classList.toggle('on', t.active && s.hasMotion);
      f.setAttribute('cx', String(150 + 6 + t.x * 108));
      f.setAttribute('cy', String(46 + 6 + t.y * 58));
    });
    const css = `rgb(${lightbar.join(',')})`;
    for (const l of this.lightbars) l.style.fill = css;
  }

  private setFill(id: string, v: number) {
    this.fills.get(id)?.setAttribute('width', String(Math.max(0, v) * 66));
  }

  private moveKnob(id: string, cx: number, cy: number, x: number, y: number) {
    const k = this.knobs.get(id);
    if (!k) return;
    k.setAttribute('cx', String(cx + x * 9));
    k.setAttribute('cy', String(cy + y * 9));
  }
}
