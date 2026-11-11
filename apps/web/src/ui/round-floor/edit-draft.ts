import {
  floorFields,
  type FloorFormState,
} from '../../features/messaging/round-floor/form-state';

export type FloorEditDraft = {
  readonly requestId: string;
  readonly baseline: string;
};

/** The text the last answer confirmed, when it is newer than the protected read. */
function confirmedText(
  answer: FloorFormState,
  canonical: { readonly text: string; readonly changeVersion: number },
): string {
  switch (answer.kind) {
    case 'changed':
      return answer.changeVersion > canonical.changeVersion
        ? answer.text
        : canonical.text;
    case 'idle':
    case 'refused':
    case 'unacknowledged':
    case 'sent':
      return canonical.text;
  }
}

/** A command owns its dirty baseline; a confirmed revision outranks a lagging protected read. */
export function floorEditSeed(
  answer: FloorFormState,
  canonical: { readonly text: string; readonly changeVersion: number },
  draft: FloorEditDraft | null,
) {
  const fields = floorFields(answer);
  const text = confirmedText(answer, canonical);
  const currentDraft = draft?.requestId === fields.requestId ? draft : null;
  const baseline = currentDraft?.baseline ?? text;
  return {
    key: `${fields.requestId}:${baseline}`,
    baseline,
    text: currentDraft || fields.notice !== undefined ? fields.text : text,
  };
}
