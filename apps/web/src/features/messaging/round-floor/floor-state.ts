import type { FloorMessage } from './history';
import type { FloorMetadata, FloorPageRead } from './view';

/** Pages before the latest, valid for the one change version they were read at. */
export type FloorOlderPages = {
  readonly changeVersion: number;
  readonly messages: readonly FloorMessage[];
  readonly before: number | null;
};

/** The messages a reader has been shown since the floor was last opened. */
export type FloorThread = {
  readonly history: FloorPageRead['history'];
  readonly authors: FloorPageRead['authors'];
  readonly bounds: FloorPageRead['bounds'];
  readonly older: FloorOlderPages | null;
  /** The older read whose answer Older messages waits for. */
  readonly paging: number | null;
};

/** What keeps a reader's open drafts mounted while the floor itself is away. */
export type KeptForms = {
  readonly channelId: string;
  readonly messageUnits: number | null;
};

export type ReadKind = 'latest' | 'older';

export type OpenFloor = {
  readonly kind: 'ready';
  readonly metadata: FloorMetadata;
  /** The floor's own expiry has passed, as the driver's timer reported. */
  readonly expired: boolean;
  readonly notice: 'read-failed' | null;
  readonly readSequence: number;
  /** The read marker on its way to the server. */
  readonly marking: {
    readonly request: number;
    readonly sequence: number;
  } | null;
  /**
   * Per kind, the newest read that no longer counts: it was applied, or the
   * floor was opened or hidden after it was asked. A read still on its way
   * does not move this, so steady traffic never leaves every answer dropped.
   */
  readonly settled: Readonly<Record<ReadKind, number>>;
  /** Null until the first latest page answers. */
  readonly thread: FloorThread | null;
};

export type FloorStanding =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'loading';
      readonly request: number;
      readonly step: 'discovering';
      /** With no channel found, whether this reader may open one. */
      readonly mayOpen: boolean;
      readonly kept: KeptForms | null;
    }
  | {
      readonly kind: 'loading';
      readonly request: number;
      readonly step: 'opening';
      readonly kept: KeptForms | null;
    }
  | {
      readonly kind: 'empty' | 'unavailable' | 'denied';
      readonly kept: KeptForms | null;
    }
  | OpenFloor;

export type FloorState = {
  /** The last request id handed out; ids are never reused across standings. */
  readonly requests: number;
  readonly standing: FloorStanding;
};

export const initialFloorState: FloorState = {
  requests: 0,
  standing: { kind: 'idle' },
};
