/** Mounted draft owners share one route decision, including dialogs opened over a page. */
type DraftGuard = { dirty: () => boolean; discard: () => void };
const guards = new Set<DraftGuard>();
export function registerDraftGuard(guard: DraftGuard) { guards.add(guard); return () => { guards.delete(guard); }; }
export const hasRegisteredDraft = () => [...guards].some(guard => guard.dirty());
export function discardRegisteredDrafts() { for (const guard of [...guards]) if (guard.dirty()) guard.discard(); }
