import type { createAdmissionPriority } from './admission-priority';
import type { Database } from '@daisy/db';
import type { MediaNodes } from '@daisy/media';
import type { ErrorReporter } from '@daisy/observability';
import type { Logger } from '@daisy/logger';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
import type { RoundIncidentObserver } from '../round-incidents/observe';
export type Store = Database['mediaSessions'];
export type Claim = Extract<
  Awaited<ReturnType<Store['claimMediaReconcile']>>,
  { kind: 'claimed' }
>;
export type Intent = Parameters<Store['beginMediaMutation']>[0]['intent'];
export type Principal = Parameters<Store['issueMediaToken']>[0]['principal'];
export type Scope = BotPublicationScope;

export type MediaOperationInput = {
  readonly priority: ReturnType<typeof createAdmissionPriority>;
  readonly store: Store;
  readonly media: Omit<MediaNodes, 'urlsFor' | 'probe'>;
  readonly urlsFor: MediaNodes['urlsFor'];
  readonly nextId: () => string;
  readonly reporter: ErrorReporter;
  readonly logger: Logger;
  /** What a recovery pass saw goes here; it owns what that means for the Round. */
  readonly observeIncident: RoundIncidentObserver;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  readonly wait: () => Promise<void>;
  /** The longest a Round goes with no recovery pass when nothing is due. */
  readonly recoveryHeartbeatMs: number;
  /** Milliseconds, read only to bound how long an admission waits. */
  readonly now: () => number;
};
