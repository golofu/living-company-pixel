import type { AgentStatus } from '../../shared/types.ts';

export interface CrewAgent {
  id: string;
  name: string;
  role: string;
  team?: string;
  status: AgentStatus;
  hiredAt?: number;
  kind?: string;
}

/** `waiting` is a human's queued work (Notifier.publicAgent), not a running task. */
export function crewForHQ(agents: Iterable<CrewAgent>): Set<string> {
  const staff = [...agents].filter(a => a.id !== '__player' && a.kind !== 'player')
    .sort((a, b) => (a.hiredAt ?? 0) - (b.hiredAt ?? 0) || a.id.localeCompare(b.id));
  const working = staff.filter(a => a.status === 'working');
  const crew = new Set(working.map(a => a.id));
  if (!working.length) return crew;
  const assistant = staff.find(a => /assistant\s*ceo|ผู้ช่วย\s*ceo|studio producer/i.test(a.role));
  if (assistant) crew.add(assistant.id);
  for (const team of new Set(working.map(a => a.team?.trim()).filter(Boolean))) {
    const members = staff.filter(a => a.team?.trim() === team);
    const head = members.find(a => /หัวหน้า|head\b|lead\b/i.test(a.role)) ?? members[0];
    if (head) crew.add(head.id);
  }
  return crew;
}
