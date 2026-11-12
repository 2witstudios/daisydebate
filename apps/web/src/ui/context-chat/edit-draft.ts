import {
  contextChatFields,
  type ContextChatFormState,
} from '../../features/messaging/context-chat/form-state';

export type ContextChatEditDraft = {
  readonly requestId: string;
  readonly baseline: string;
};

/** The text the last answer confirmed, when it is newer than the protected read. */
function confirmedText(
  answer: ContextChatFormState,
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
export function contextChatEditSeed(
  answer: ContextChatFormState,
  canonical: { readonly text: string; readonly changeVersion: number },
  draft: ContextChatEditDraft | null,
) {
  const fields = contextChatFields(answer);
  const text = confirmedText(answer, canonical);
  const currentDraft = draft?.requestId === fields.requestId ? draft : null;
  const baseline = currentDraft?.baseline ?? text;
  return {
    key: `${fields.requestId}:${baseline}`,
    baseline,
    text: currentDraft || fields.notice !== undefined ? fields.text : text,
  };
}
