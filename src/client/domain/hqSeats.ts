import { seatPoint, zoneAt, type OfficeItem, type Point } from '../../shared/catalog.ts';

export interface HQSeat extends Point { id: string }

export function hqSeats(items: OfficeItem[]): HQSeat[] {
  return items.filter(i => i.type === 'teamdesk').flatMap(i => (i.seats ?? []).flatMap(s => {
    const p = seatPoint([i], s.id)!;
    return s.id.startsWith('hq-') && zoneAt(items, p.x, p.z)?.room === 'hq' ? [{ ...p, id: s.id }] : [];
  }));
}

/** Shares the world's spot maps: a reserved seat remains its owner's until explicitly released. */
export function claimHQSeat(id: string, seats: HQSeat[], claims: Map<string, string>, points: Map<string, Point | { x: number; z: number }>): HQSeat | undefined {
  const seat = seats.find(s => claims.get(s.id) === id) ?? seats.find(s => !claims.has(s.id) &&
    [...points].every(([key, p]) => claims.get(key) === id || Math.hypot(s.x - p.x, s.z - p.z) >= 0.75));
  if (seat) { claims.set(seat.id, id); points.set(seat.id, seat); }
  return seat;
}
