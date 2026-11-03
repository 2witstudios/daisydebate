import type { RoundMediaState } from '@daisy/protocol';
import { snapshot } from '../media-fixtures.test-support';
import {
  initialMediaState,
  type LiveConnection,
  type MediaLink,
  type MediaPolicy,
  type MediaState,
  type ReleaseReason,
  type Source,
  type SourceState,
} from './media-state';
import { statusOf, type MediaConnectionLabel } from './media-status';
import { publicationOf } from './media-publication';
import type { SourceFailureKind } from '../source-failure';

export const testPolicy: MediaPolicy = {
  requestRetryDelaysMs: [500, 1_000, 2_000],
  readBudgetMs: 43_500,
  resumeBudgetMs: 5_000,

  capturePatienceMs: 3_000,
  recoveryDelaysMs: [1_000, 2_000, 4_000, 8_000, 10_000],
  eventFloorMs: 5_000,
};

export const answerWith = (publish: readonly Source[]): RoundMediaState =>
  ({
    ...snapshot,
    grants: { ...snapshot.grants, publish },
  }) as RoundMediaState;

export const liveLink = (
  overrides: Partial<LiveConnection> = {},
): LiveConnection => ({
  phase: 'live',
  connection: 1,
  identity: 'seat',
  room: snapshot.room,
  establishment: {
    stage: 'established',
    media: answerWith([]),
    freshness: { status: 'current' },
  },
  grants: [],
  permission: null,
  sources: { camera: { phase: 'off' }, microphone: { phase: 'off' } },
  tracks: [],
  peers: [],
  sound: 'allowed',
  changingMicrophone: false,
  transport: 'steady',
  reads: { flight: null, next: 'none', supersededSinceAnswer: 0 },
  apply: null,
  ...overrides,
});

export const stateWith = (
  link: MediaLink,
  overrides: Partial<MediaState> = {},
): MediaState => ({
  ...initialMediaState({ roundViewVersion: 1, microphoneMuted: false }),
  nextConnection: 2,
  link,
  ...overrides,
});

type Evidence = {
  readonly failure?: ReleaseReason | null;
  readonly illHealth?: readonly (readonly [
    Source,
    SourceFailureKind | 'removal' | 'waiting',
  ])[];
  readonly microphone?: {
    readonly granted: boolean | null;
    readonly published: boolean;
    readonly muted: boolean;
  } | null;
  readonly sound?: { readonly blocked: boolean } | null;
};

const linkFor = (
  connection: MediaConnectionLabel,
  missing: readonly Source[],
  evidence: Evidence,
): MediaLink => {
  switch (connection) {
    case 'connecting':
    case 'reconnecting':
      return {
        phase: 'admitting',
        connection: 1,
        ownRetry:
          connection === 'reconnecting' ? null : { attempt: 0, pausing: false },
      };
    case 'unavailable':
      return { phase: 'released', why: evidence.failure ?? 'definite' };
    case 'ended':
      return { phase: 'ended' };
    default: {
      const sources: Record<Source, SourceState> = {
        camera: { phase: 'off' },
        microphone: { phase: 'off' },
      };
      for (const [source, kind] of evidence.illHealth ?? [])
        sources[source] =
          kind === 'waiting'
            ? { phase: 'capturing', waiting: true }
            : kind === 'removal'
              ? { phase: 'stale-publication' }
              : { phase: 'failed', kind, removingSinceMs: null };
      for (const source of missing) sources[source] = { phase: 'missing' };
      const mic = evidence.microphone;
      return liveLink({
        establishment: {
          stage: 'established',
          media: answerWith(mic?.granted ? ['microphone'] : []),
          freshness:
            connection === 'out-of-date'
              ? { status: 'stale', cause: 'transient', wakeArmed: true }
              : { status: 'current' },
        },
        sources,
        sound: evidence.sound?.blocked ? 'blocked' : 'allowed',
        tracks: mic?.published
          ? [
              {
                identity: 'seat',
                source: 'microphone',
                local: true,
                speaking: false,
                muted: mic.muted,
              },
            ]
          : [],
      });
    }
  }
};

/** A state holding this evidence, as the status tests describe it. */
export const mediaStatus = (
  connection: MediaConnectionLabel,
  missing: readonly Source[],
  evidence: Evidence = {},
) =>
  statusOf(
    stateWith(linkFor(connection, missing, evidence), {
      microphoneMuted: evidence.microphone?.muted ?? false,
    }),
  );

export const localPublicationOf = (input: {
  readonly connection: MediaConnectionLabel;
  readonly failure: ReleaseReason | null;
  readonly grants: readonly Source[] | undefined;
  readonly captured: readonly Source[] | undefined;
  readonly muted: boolean | undefined;
}) => {
  const base = linkFor(input.connection, [], { failure: input.failure });
  return publicationOf(
    stateWith(
      base.phase === 'live'
        ? {
            ...base,
            establishment: input.grants
              ? {
                  stage: 'established',
                  media: answerWith(input.grants),
                  freshness: { status: 'current' },
                }
              : { stage: 'establishing', reconnecting: false },
            tracks: input.captured?.includes('microphone')
              ? [
                  {
                    identity: 'seat',
                    source: 'microphone',
                    local: true,
                    speaking: false,
                    muted: input.muted ?? false,
                  },
                ]
              : [],
          }
        : base,
    ),
  );
};
