import type { FloorFormState } from '../../features/messaging/round-floor/form';

export type FloorEditDraft = {
  readonly requestId: string;
  readonly baseline: string;
};
/** A command owns its dirty baseline; a confirmed revision outranks a lagging protected read. */
export function floorEditSeed(
  answer: FloorFormState,
  canonical: { readonly text: string; readonly changeVersion: number },
  draft: FloorEditDraft | null,
) {
  const text =
    answer.changeVersion !== undefined &&
    answer.changeVersion > canonical.changeVersion
      ? answer.text
      : canonical.text;
  const currentDraft = draft?.requestId === answer.requestId ? draft : null;
  const baseline = currentDraft?.baseline ?? text;
  return {
    key: `${answer.requestId}:${baseline}`,
    baseline,
    text:
      currentDraft || answer.uncertain || answer.notice ? answer.text : text,
  };
}
