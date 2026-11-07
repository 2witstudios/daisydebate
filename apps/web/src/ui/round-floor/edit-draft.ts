import type { FloorFormState } from '../../features/messaging/round-floor/form';
/** Clean editors follow canonical revisions; a dirty or uncertain command owns its draft. */
export const floorEditSeed = (
  answer: FloorFormState,
  canonicalText: string,
  dirty: boolean,
) => (dirty || answer.uncertain || answer.notice ? answer.text : canonicalText);
