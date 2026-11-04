import { projectAudienceSnapshot } from '@daisy/debate-engine';
import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { ErrorReporter } from '@daisy/observability';
import { idSchema, type AudienceSnapshot } from '@daisy/protocol';
import type { Identity } from '@daisy/auth';
import { handleOperation } from '../../server/http';
import { admitAudience } from './read-timeline';
import { answerUnlessRefused } from './refused-read';
import { audienceShownTo, type AudienceShown } from './seated-audience';

export type AudienceSnapshotStore = Pick<Database, 'readAudienceSnapshot'>;
/** A Round's audience as it stands, not yet admitted to anyone. */
export type AudienceRead = {
  readonly visibility: 'public' | 'unlisted';
  readonly snapshot: AudienceSnapshot;
};

/**
 * Near real time, through moderation alone, for everyone on the shared feed (ADR
 * 0108). Carries no count: only the publisher knows the sampling that scales one, so
 * a viewer's count arrives with the first published state. Null when the Round has no
 * audience. Never answer one without `admitAudience`.
 */
export const readAudienceSnapshot = async (
  deps: { readonly store: AudienceSnapshotStore },
  input: { readonly roundId: string },
): Promise<AudienceRead | null> => {
  if (!idSchema.safeParse(input.roundId).success) return null;
  const read = await deps.store.readAudienceSnapshot({
    roundId: input.roundId,
  });
  if (!read) return null;
  return {
    visibility: read.visibility,
    snapshot: projectAudienceSnapshot(input.roundId, read, null),
  };
};

/** The snapshot with what this reader may not see taken out, and what they may. */
export const audienceFor = (
  snapshot: AudienceSnapshot,
  shown: AudienceShown,
): AudienceSnapshot => ({
  ...snapshot,
  messages: shown.chat ? snapshot.messages : [],
  reactions: shown.reactions ? snapshot.reactions : [],
  viewers: shown.viewers ? snapshot.viewers : null,
});

type AdmissionStore = Parameters<typeof admitAudience>[0] &
  Pick<Database, 'readLiveRoomStanding'>;

/**
 * GET /api/rounds/:id/audience, for someone in the Round's live room alone: what they
 * may see is their own, so it cannot be the published state. A viewer reads that from
 * the public bucket, and this answers a request with no live room as missing.
 */
export function createAudienceSnapshotRoute(deps: {
  readonly logger: Logger;
  readonly reporter: ErrorReporter;
  readonly store: AudienceSnapshotStore & AdmissionStore;
  readonly identify: (request: Request) => Promise<Identity>;
}) {
  const notFound = () =>
    Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  return (request: Request, roundId: string) =>
    handleOperation(
      deps.logger,
      request,
      'audience.snapshot',
      () =>
        answerUnlessRefused(async () => {
          if (!idSchema.safeParse(roundId).success) return notFound();
          const identity = await deps.identify(request);
          const actorId =
            'principal' in identity && identity.principal.kind === 'user'
              ? identity.principal.actorId
              : null;
          const standing = actorId
            ? await deps.store.readLiveRoomStanding({ roundId, actorId })
            : null;
          if (!standing) return notFound();
          const read = await readAudienceSnapshot(deps, { roundId });
          return read
            ? Response.json(
                audienceFor(read.snapshot, audienceShownTo(standing)),
                {
                  headers: { 'X-Robots-Tag': 'noindex' },
                },
              )
            : notFound();
        }),
      deps.reporter,
    );
}

/**
 * A render's read for one viewer, or null when they cannot reach the Round. A
 * standing is read only for an account with an actor, and a visitor's read touches
 * nothing about who they are. Someone in the live room needs no link to it.
 */
export const readAudienceForViewer = async (
  deps: { readonly store: AudienceSnapshotStore & AdmissionStore },
  input: {
    readonly roundId: string;
    readonly actorId: string | null;
    readonly presentedHash: string | null;
  },
) => {
  const read = await readAudienceSnapshot(deps, input);
  if (!read) return null;
  const standing = input.actorId
    ? await deps.store.readLiveRoomStanding({
        roundId: input.roundId,
        actorId: input.actorId,
      })
    : null;
  if (standing === null && !(await admitAudience(deps.store, read, input)))
    return null;
  const shown = audienceShownTo(standing);
  return {
    snapshot: audienceFor(read.snapshot, shown),
    shown,
    seated: standing?.kind === 'seat',
    inLiveRoom: standing !== null,
    unlisted: read.visibility === 'unlisted',
  };
};
