/** App-wide (non-preset) settings, persisted per browser. */
import type { TriggerEffect } from './input/dualsense-report';

export type SkinId = 'chrome-blue' | 'toxic-green' | 'classic-amp';
export type TriggerMode = TriggerEffect['mode'];

export interface Settings {
  skin: SkinId;
  inputOn: boolean;
  motionOn: boolean;
  lightbarFollowsPreset: boolean;
  lightbarColor: string;
  rumbleOnHit: boolean;
  l2Mode: TriggerMode;
  l2Strength: number;
  r2Mode: TriggerMode;
  r2Strength: number;
}

const KEY = 'drumtroller.settings.v1';

export const SKINS: { id: SkinId; label: string }[] = [
  { id: 'chrome-blue', label: 'CHROME BLUE' },
  { id: 'toxic-green', label: 'TOXIC GREEN' },
  { id: 'classic-amp', label: 'CLASSIC AMP' },
];

export function defaultSettings(): Settings {
  return {
    skin: 'chrome-blue',
    inputOn: true,
    motionOn: true,
    lightbarFollowsPreset: true,
    lightbarColor: '#ff8000',
    rumbleOnHit: false,
    l2Mode: 'off',
    l2Strength: 4,
    r2Mode: 'off',
    r2Strength: 4,
  };
}

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const k of Object.keys(s) as (keyof Settings)[]) {
          if (typeof parsed[k] === typeof s[k]) (s as unknown as Record<string, unknown>)[k] = parsed[k];
        }
      }
    }
  } catch {
    /* storage unavailable */
  }
  if (!SKINS.some((k) => k.id === s.skin)) s.skin = 'chrome-blue';
  return s;
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function triggerEffect(mode: TriggerMode, strength: number): TriggerEffect {
  switch (mode) {
    case 'off':
      return { mode: 'off' };
    case 'feedback':
      return { mode: 'feedback', position: 2, strength };
    case 'weapon':
      return { mode: 'weapon', start: 3, end: 6, strength };
    case 'vibration':
      return { mode: 'vibration', position: 2, amplitude: strength, frequency: 30 };
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xff8000;
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
