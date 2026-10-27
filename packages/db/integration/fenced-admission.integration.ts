import { assert, setupRitewayBun, test } from 'riteway/bun';
import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createAttendanceOperations } from '../src/attendance-operations';
import { withFixture } from './constraint-helpers';
import {
  mediaTestTick as buildProjection,
  mediaTestStore,
} from './media-session.test-support';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

/** The operator's revoke, as its command commits it (ADR 0075). */
const revoke =
  (sql: Parameters<Parameters<typeof withFixture>[1]>[0]['sql']) =>
  async (actorId: string) => {
    await sql`update account_beta_access set state = 'revoked', revision = revision + 1, decided_at = now() where user_id = (select user_id from actors where id = ${actorId})`;
    await sql`update users set version = version + 1 where id = (select user_id from actors where id = ${actorId})`;
  };

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'allowed',
    (error: { code?: string }) => error.code ?? 'error',
  );

type Fixture = Parameters<Parameters<typeof withFixture>[1]>[0];

/** A live Round with two verified human debaters and the media store. */
async function liveRound(fixture: Fixture) {
  const roundId = await fixture.round({
    status: 'active',
    current_stage: 'live',
    started_at: new Date('2026-10-22T05:00:00Z'),
  });
  const revoked = await fixture.seat(roundId, 'affirmative');
  const opponent = await fixture.seat(roundId, 'negative');
  // A media seat also needs a verified member account.
  await fixture.sql`update users set email_verified = true where id in (select user_id from actors where id in (${revoked.actorId}, ${opponent.actorId}))`;
  const media = mediaTestStore(fixture.sql);
  const bind = (actorId: string) =>
    media.ensureBinding({
      roundId,
      caller: { actorId, admits: admitsPrincipalAccess },
      buildProjection,
    });
  return { roundId, revoked, opponent, media, bind };
}

test('a revoked participant is refused media and attendance inside their fences, the opponent is not (ISSUE-693)', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, revoked, opponent, bind } = await liveRound(fixture);
    await revoke(fixture.sql)(revoked.actorId);
    const db = drizzle({ client: fixture.sql });
    const attendance = createAttendanceOperations({
      nextAttemptId: createId,
      verifyWorker: async () => {
        throw new Error('Human fixture cannot enter the bot verifier');
      },
      transaction: (work) =>
        db.transaction((tx) =>
          work(tx, { receivedAt: '2026-10-22T05:00:00.000000Z' }),
        ),
    });
    try {
      assert({
        given:
          'a participant revoked after seating (the edge already read their identity) and their admitted opponent',
        should:
          'refuse the revoked caller media and attendance from the fenced facts, and keep the opponent in',
        actual: {
          revokedMedia: await codeOf(bind(revoked.actorId)),
          revokedAttendance: await codeOf(
            attendance.readRoundAttendanceTargets({
              roundId,
              principal: { kind: 'human', actorId: revoked.actorId },
              admits: admitsPrincipalAccess,
            }),
          ),
          opponentMedia: await codeOf(bind(opponent.actorId)),
          opponentAttendance: await codeOf(
            attendance.readRoundAttendanceTargets({
              roundId,
              principal: { kind: 'human', actorId: opponent.actorId },
              admits: admitsPrincipalAccess,
            }),
          ),
        },
        expected: {
          revokedMedia: 'AUTHORIZATION',
          revokedAttendance: 'AUTHORIZATION',
          opponentMedia: 'allowed',
          opponentAttendance: 'allowed',
        },
      });
    } finally {
      // The opponent's binding wrote media rows the fixture does not track.
      await fixture.sql`delete from media_sessions where round_id = ${roundId}`;
    }
  });
});

test('a revoke withdraws the media grants of a human already bound, inside the reconcile fences (ISSUE-714)', async () => {
  await withFixture(url, async (fixture) => {
    const { roundId, revoked, opponent, media, bind } =
      await liveRound(fixture);
    try {
      // Both joined before the revoke.
      const session = await bind(revoked.actorId);
      await bind(opponent.actorId);
      await revoke(fixture.sql)(revoked.actorId);
      const snapshot = await media.readMediaSession({
        roundId,
        admits: admitsPrincipalAccess,
        buildProjection,
      });
      await media.requestMediaReconcile({ roundId });
      const claim = await media.claimMediaReconcile({
        sessionId: session.sessionId,
        owner: createId(),
      });
      if (claim.kind !== 'claimed') throw new Error('Missing reconcile claim');
      let authority: readonly string[] | null = null;
      const intent = await media.beginMediaMutation({
        ...claim.fence,
        intent: { kind: 'create', identity: null, payload: {} },
        buildProjection,
        admits: admitsPrincipalAccess,
        authorize: (context) => {
          authority = context.withdrawn;
        },
      });
      // A pending vendor intent cannot be erased: settle it before cleanup.
      await media.settleMediaMutation(intent, 'failed');
      const eligible = (seatId: string) =>
        snapshot?.participants.find((seat) => seat.id === seatId)?.eligible;
      assert({
        given:
          'two bound debaters, then the affirmative revoked while the Round is live',
        should:
          "withdraw only the revoked seat in the reconcile snapshot and in every mutation's authority, and keep both seats in the Round",
        actual: {
          withdrawn: snapshot?.withdrawn,
          authority,
          seats: [eligible(revoked.id), eligible(opponent.id)],
        },
        expected: {
          withdrawn: [revoked.id],
          authority: [revoked.id],
          seats: [true, true],
        },
      });
    } finally {
      await fixture.sql`delete from media_vendor_mutations where session_id in (select id from media_sessions where round_id = ${roundId})`;
      await fixture.sql`delete from media_participants where session_id in (select id from media_sessions where round_id = ${roundId})`;
      await fixture.sql`delete from media_sessions where round_id = ${roundId}`;
    }
  });
});
