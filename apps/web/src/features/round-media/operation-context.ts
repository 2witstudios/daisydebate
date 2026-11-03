import type { createAdmissionPriority } from './admission-priority';
import type { Database } from '@daisy/db';
import type { createMediaService } from '@daisy/media';
import type { ErrorReporter } from '@daisy/observability';
import type { Logger } from '@daisy/logger';
import type { BotPublicationScope } from '@daisy/db/bot-publication';
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
  readonly media: ReturnType<typeof createMediaService>;
  readonly publicUrl: string;
  readonly workerUrl: string;
  readonly nextId: () => string;
  readonly reporter: ErrorReporter;
  readonly logger: Logger;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  readonly wait: () => Promise<void>;
  /** The longest a Round goes with no recovery pass when nothing is due. */
  readonly recoveryHeartbeatMs: number;
  /** Milliseconds, read only to bound how long an admission waits. */
  readonly now: () => number;
  /** Which camera a seat captures. Only a hint about quality: it decides no authority. */
  readonly cameraProfile?: (
    roundId: string,
  ) => Promise<'standard' | 'broadcast'>;
};
