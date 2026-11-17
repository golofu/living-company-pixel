// Offline review: node --import tsx src/client/infrastructure/pixel/dev/renderHq.ts <outDir> [suffix]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planOffice } from '../../../../shared/layout.ts';
import { createT } from '../../../../shared/i18n/index.ts';
import { compose } from './sheetOffice.ts';
import { savePng } from './png.ts';

const out = process.argv[2];
if (!out) throw new Error('usage: renderHq.ts <outDir> [suffix]');
mkdirSync(out, { recursive: true });
for (const name of ['gas', 'film', 'vibecode', 'research']) {
  const source = JSON.parse(readFileSync(new URL(`../../../../../kit-3d/rosters/${name}.json`, import.meta.url), 'utf8'));
  const agents = source.agents.map((a: { team: string }, i: number) => ({ id: `${name}-${i}`, team: a.team, hiredAt: i }));
  const p = planOffice(agents, createT('en'));
  savePng(join(out, `${name}${process.argv[3] ?? ''}.png`), compose(p.items, p.width, p.depth, { dark: false, frame: 0, walls: true, people: true }), 2);
  console.log(`${name}: ${agents.length} agents, ${p.width}x${p.depth} = ${p.width * p.depth}`);
  console.log(p.items.filter(i => i.type === 'zone').map(i => `${i.label}@${i.x},${i.z} ${i.w}x${i.d}`).join(' | '));
}
