import type { ResourceIdentity } from './resource-sync';

/** Test support: the smallest synced resource, a labelled versioned doc. */
export type Doc = {
  readonly id: string;
  readonly version: number;
  readonly label: string;
};

export const docIdentity: ResourceIdentity<Doc> = {
  id: (doc) => doc.id,
  version: (doc) => doc.version,
};

export const doc = (version: number, label: string): Doc => ({
  id: 'd1',
  version,
  label,
});
