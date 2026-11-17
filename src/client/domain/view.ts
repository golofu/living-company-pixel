export type OfficeView = 'pixel' | '3d';
export const VIEW_KEY = 'agent-office:view';
/** Query overrides are deliberately never persisted. */
export function readView(saved: string | null, search = ''): OfficeView {
  const query = new URLSearchParams(search).get('view');
  return query === 'pixel' || query === '3d' ? query : saved === '3d' ? '3d' : 'pixel';
}
