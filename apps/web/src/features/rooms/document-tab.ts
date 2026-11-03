import { createId } from '@paralleldrive/cuid2';

let tabId: string | null = null;

/** One document's identity, never sessionStorage (which a newly opened tab may clone). */
export const documentTabId = (): string => (tabId ??= createId());
