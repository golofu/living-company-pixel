import entries from './looks.json';

export interface Look {
  sex: 'f' | 'm';
  outfit: 'suit' | 'formal' | 'casual';
  hair: 'long' | 'bob' | 'bun' | 'ponytail' | 'short';
  hairColor: string;
  skin: string;
  glasses: boolean;
  top: string;
  inner: string;
  bottom: string;
  shoes: string;
}

export const looks = entries as Record<string, Look>;

/** Stable across sessions, roster order and status changes. */
export function lookFor(name: string, id: string, color: string): Look {
  if (Object.hasOwn(looks, name)) return { ...looks[name] };
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0;
  return {
    sex: hash % 2 ? 'f' : 'm',
    outfit: (['suit', 'formal', 'casual'] as const)[(hash >>> 2) % 3],
    hair: (['long', 'bob', 'bun', 'ponytail', 'short'] as const)[(hash >>> 5) % 5],
    hairColor: ['#171214', '#39271e', '#6a4630'][(hash >>> 8) % 3],
    skin: ['#e7bf9c', '#dcae88', '#c18e68'][(hash >>> 10) % 3],
    glasses: (hash >>> 12) % 4 === 0,
    top: color, inner: '#eee9e1', bottom: '#303442', shoes: '#222329',
  };
}

export function playerLook(): Look {
  return Object.hasOwn(looks, 'CEO') ? { ...looks.CEO } : {
    sex: 'm', outfit: 'suit', hair: 'short', hairColor: '#211918',
    skin: '#dfb38e', glasses: false, top: '#1c2d4d', inner: '#f4f2ed',
    bottom: '#1c2d4d', shoes: '#202126',
  };
}

export function modelFileFor(look: Look) {
  const outfit = look.sex === 'm' && look.outfit === 'formal' ? 'suit' : look.outfit;
  return `${look.sex}-${outfit}.gltf`;
}
