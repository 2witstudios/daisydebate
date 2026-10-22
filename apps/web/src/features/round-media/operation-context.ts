import type { Database } from '@daisy/db';
import type { createMediaService } from '@daisy/media';
import type { ErrorReporter } from '@daisy/observability';
import type { Logger } from '@daisy/logger';
export type Store = Database['mediaSessions'];
export type Claim = Extract<
  Awaited<ReturnType<Store['claimMediaReconcile']>>,
  { kind: 'claimed' }
>;
export type Intent = Parameters<Store['beginMediaMutation']>[0]['intent'];
export type Principal = Parameters<Store['issueMediaToken']>[0]['principal'];
export type Scope = Parameters<Store['ensureBotBinding']>[0]['scope'];

export type MediaOperationInput = {
  readonly store: Store;
  readonly media: ReturnType<typeof createMediaService>;
  readonly publicUrl: string;
  readonly workerUrl: string;
  readonly nextId: () => string;
  readonly reporter: ErrorReporter;
  readonly logger: Logger;
  readonly deadline: <T>(work: Promise<T>) => Promise<T>;
  readonly wait: () => Promise<void>;
};
