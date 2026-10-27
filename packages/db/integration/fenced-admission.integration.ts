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

test('a revoked participant is refused media and attendance inside their fences, the opponent is not (ISSUE-693)', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-22T05:00:00Z'),
    });
    const revoked = await fixture.seat(roundId, 'affirmative');
    const opponent = await fixture.seat(roundId, 'negative');
    // A media seat also needs a verified member account.
    await fixture.sql`update users set email_verified = true where id in (select user_id from actors where id in (${revoked.actorId}, ${opponent.actorId}))`;
    await revoke(fixture.sql)(revoked.actorId);
    const media = mediaTestStore(fixture.sql);
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
    const bind = (actorId: string) =>
      media.ensureBinding({
        roundId,
        caller: { actorId, admits: admitsPrincipalAccess },
        buildProjection,
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
        },
        expected: {
          revokedMedia: 'AUTHORIZATION',
          revokedAttendance: 'AUTHORIZATION',
          opponentMedia: 'allowed',
        },
      });
    } finally {
      // The opponent's binding wrote media rows the fixture does not track.
      await fixture.sql`delete from media_sessions where round_id = ${roundId}`;
    }
  });
});
