// One palette for everything drawn by code, so furniture, street and people read as one picture.
// Use these names instead of new hex values. Per-person colours (skin, hair, clothes) come from the Look and are
// only shaded with `shade()`; office floor and wall colours come from the Office and are treated the same way.
import { rgba } from './types.ts';

export const P = {
  // outlines and darks
  ink: rgba('#16131f'), night: rgba('#0d0b16'), shadow: rgba('#000000', 70),
  // neutrals
  white: rgba('#f4f1ea'), paper: rgba('#e9e2d0'), grey1: rgba('#cfcfd6'), grey2: rgba('#8d8794'), grey3: rgba('#5a5560'), grey4: rgba('#3a3346'), asphalt: rgba('#2a2a31'),
  // wood and warm
  wood1: rgba('#8a6446'), wood2: rgba('#6b4a33'), wood3: rgba('#4a3222'), brick: rgba('#7a1f24'), terracotta: rgba('#a0522d'),
  // greens
  leaf1: rgba('#64d68a'), leaf2: rgba('#3fb463'), leaf3: rgba('#2f8f4e'), taxiGreen: rgba('#3fa34d'),
  // blues
  screen: rgba('#5fd3ff'), screenHi: rgba('#e8fbff'), glass: rgba('#9fd8f0'), navy: rgba('#1f3a5c'), steel: rgba('#343b49'), steelDark: rgba('#2a2f3a'),
  // accents
  red: rgba('#d8262d'), redNeon: rgba('#ff3b3b'), pink: rgba('#ff5ec4'), magenta: rgba('#d6246e'), orange: rgba('#ff9b3d'),
  gold: rgba('#f0b429'), yellow: rgba('#f2d73a'), lampGlow: rgba('#ffe9a0'), cyan: rgba('#38d9ff'), mint: rgba('#3dff9a'), purple: rgba('#5a2a6e'), teal: rgba('#2fa5a5'),
} as const;

/** Sign and wall colours of one street theme; city.ts picks one by seed. */
export interface Theme { wall: string; neon: string; accent: string }
export const THEMES: Theme[] = [
  { wall: '#7a1f24', neon: '#ff3b3b', accent: '#3dff9a' },
  { wall: '#1f3a5c', neon: '#38d9ff', accent: '#ffcf3a' },
  { wall: '#5a2a6e', neon: '#ffcf3a', accent: '#ff5ec4' },
  { wall: '#1f4a3a', neon: '#3dff9a', accent: '#ff9b3d' },
];
