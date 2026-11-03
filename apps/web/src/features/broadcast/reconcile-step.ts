import {
  decideBroadcast,
  type BroadcastAction,
  type BroadcastFacts,
} from '@daisy/debate-engine';

type ReportedEvent =
  | 'broadcast.egress.start_failed'
  | 'broadcast.egress.start_lost'
  | 'broadcast.egress.stop_failed'
  | 'broadcast.egress.stopped_unconfirmed'
  | 'broadcast.observer.restore_failed'
  | 'broadcast.observer.revoke_retry_failed'
  | 'broadcast.complete_failed';

export type ReconcilePorts = {
  /** The claim outlasts a start, so no other instance starts another. */
  readonly holdClaim: () => Promise<void>;
  readonly releaseClaim: () => Promise<void>;
  readonly startEgress: () => Promise<string>;
  /** False means another start won this generation. */
  readonly recordEgressStarted: (id: string) => Promise<boolean>;
  readonly stopEgress: (id: string) => Promise<void>;
  readonly revokeObserver: () => Promise<void>;
  readonly recordRevoked: () => Promise<void>;
  readonly recordRevocationFailed: () => Promise<void>;
  readonly restoreObserver: () => Promise<void>;
  readonly recordRestored: () => Promise<void>;
  readonly recordFinalMediaEnd: () => Promise<void>;
  readonly complete: () => Promise<void>;
  readonly report: (event: ReportedEvent) => void;
};

const attempt = async (
  work: () => Promise<void>,
  failed: () => Promise<void> | void,
) => {
  try {
    await work();
  } catch {
    await failed();
  }
};

const run = (action: BroadcastAction, ports: ReconcilePorts) => {
  switch (action.type) {
    case 'start-egress':
      return attempt(
        async () => {
          await ports.holdClaim();
          const id = await ports.startEgress();
          if (await ports.recordEgressStarted(id)) return;
          ports.report('broadcast.egress.start_lost');
          await ports.stopEgress(id);
        },
        () => ports.report('broadcast.egress.start_failed'),
      ).finally(() => ports.releaseClaim());
    case 'stop-egress':
      return attempt(
        async () => {
          await ports.stopEgress(action.id);
          if (action.reason === 'revocation-unconfirmed')
            ports.report('broadcast.egress.stopped_unconfirmed');
          if (action.reason === 'round-ended')
            await ports.recordFinalMediaEnd();
        },
        () => ports.report('broadcast.egress.stop_failed'),
      );
    case 'record-media-ended':
      return attempt(
        () => ports.recordFinalMediaEnd(),
        () => ports.report('broadcast.complete_failed'),
      );
    case 'revoke-observer':
      return attempt(
        async () => {
          await ports.revokeObserver();
          await ports.recordRevoked();
        },
        () => ports.recordRevocationFailed(),
      );
    case 'reassert-revocation':
      return attempt(
        () => ports.revokeObserver(),
        () => ports.report('broadcast.observer.revoke_retry_failed'),
      );
    case 'restore-observer':
      return attempt(
        async () => {
          await ports.restoreObserver();
          await ports.recordRestored();
        },
        () => ports.report('broadcast.observer.restore_failed'),
      );
    case 'forget-revocation':
      return attempt(
        () => ports.recordRestored(),
        () => ports.report('broadcast.observer.restore_failed'),
      );
    case 'complete':
      return attempt(
        () => ports.complete(),
        () => ports.report('broadcast.complete_failed'),
      );
  }
};

/**
 * One pass over observed facts. It always resolves: a failed action is recorded
 * or reported and the next pass decides again, and nothing here reaches the Round.
 */
export const reconcileStep = async (
  facts: BroadcastFacts,
  ports: ReconcilePorts,
): Promise<void> => {
  for (const action of decideBroadcast(facts)) await run(action, ports);
};
