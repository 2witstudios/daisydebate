export type DebateDocumentFolder = 'round' | 'library';

/** A new round-room document; `aiDebateId` is set iff `folder` is 'round'. */
export type NewDebateDocument = {
  readonly id: string;
  readonly ownerUserId: string;
  readonly aiDebateId: string | null;
  readonly folder: DebateDocumentFolder;
  readonly templateId: string;
  readonly title: string;
  /** Normalized HTML; the adapter never normalizes, its caller must. */
  readonly html: string;
  readonly createdAt: Date;
};

export type DebateDocumentRecord = NewDebateDocument & {
  readonly revision: number;
  readonly updatedAt: Date;
};

export type DebateDocumentSave =
  | { readonly status: 'saved'; readonly revision: number }
  | { readonly status: 'conflict'; readonly revision: number }
  | { readonly status: 'missing' };
