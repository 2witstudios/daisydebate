import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { Clock, IdGenerator } from '@daisy/clock';
import type { ReportStore } from '@daisy/db/reports';
import { createAppError, isAppError } from '@daisy/errors';
import type { ReportReason, ReportSurface } from '@daisy/protocol';
import type { DiscoverActor } from '../account/username-discovery';
import { requireMemberActor } from '../access/actor';

/** Reports per member per hour: enough for a bad night, not for a campaign. */
export const REPORT_RULE = { windowSeconds: 3_600, max: 20 } as const;

/**
 * How long a closed report's evidence is kept. A proposed value awaiting
 * counsel (DEC-298, COMP-4); this one line changes it, with no migration.
 */
export const REPORT_EVIDENCE_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Files a report (ADR 0098): a reason and where it was made, nothing else. A
 * safety exit, so it stays open across a block. An unknown name or a closed
 * account answers NOT_FOUND. Filing twice while one is open changes nothing.
 */
export async function fileReport(
  principal: AuthorizationPrincipal,
  input: {
    readonly username: string;
    readonly reason: ReportReason;
    readonly surface: ReportSurface;
  },
  dependencies: {
    readonly clock: Clock;
    readonly ids: IdGenerator;
    readonly limit: (actorId: string) => Promise<void>;
    readonly discover: DiscoverActor;
    readonly store: () => ReportStore;
  },
): Promise<{ readonly username: string; readonly state: 'reported' }> {
  const { actorId, userId } = requireMemberActor(principal);
  await dependencies.limit(actorId);
  const subjectActorId = await dependencies.discover(actorId, input.username);
  if (!subjectActorId || subjectActorId === actorId)
    throw createAppError('NOT_FOUND');
  try {
    await dependencies.store().file(
      { actorId, userId, memberActorIds: [actorId, subjectActorId] },
      {
        id: dependencies.ids.next(),
        subjectActorId,
        reason: input.reason,
        surface: input.surface,
        now: dependencies.clock.now(),
      },
    );
  } catch (error) {
    if (isAppError(error) && error.code === 'AUTHORIZATION')
      throw createAppError('NOT_FOUND');
    throw error;
  }
  return { username: input.username, state: 'reported' };
}
