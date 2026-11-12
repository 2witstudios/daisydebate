import {
  mediaPhase,
  mediaRoomFate,
  nextRoomVacancy,
} from '@daisy/debate-engine';
import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { withFixture } from './constraint-helpers';
import {
  mediaTestHuman,
  mediaTestStore,
  mediaTestTick,
} from './media-session.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

type Fixture = Parameters<typeof mediaTestHuman>[0];

/** A bound human seat in a Round that then completed, with or without the call chosen. */
async function completedRound(fixture: Fixture, postRoundCall: boolean) {
  const { roundId, seat } = await mediaTestHuman(fixture);
  const store = mediaTestStore(fixture.sql);
  const caller = { actorId: seat.actorId, admits: admitsPrincipalAccess };
  const bind = () =>
    store.ensureBinding({
      mediaPhase,
      roundId,
      caller,
      buildProjection: mediaTestTick,
    });
  const binding = await bind();
  await fixture.sql.unsafe(
    `update rounds set status='completed', current_stage=null,
       started_at=coalesce(started_at, created_at), completed_at=clock_timestamp(),
       post_round_call=$2 where id=$1`,
    [roundId, postRoundCall],
  );
  /** One reconcile pass that did, or did not, prove the session's room absent. */
  const pass = async (proven: boolean) => {
    // Past the minimum interval between passes.
    await fixture.sql.unsafe(
      "update media_sessions set reconcile_started_at=clock_timestamp()-interval '2 seconds' where id=$1",
      [binding.sessionId],
    );
    const claim = await store.claimMediaReconcile({
      sessionId: binding.sessionId,
      owner: createId(),
    });
    if (claim.kind !== 'claimed') throw new Error('The pass was not claimed');
    return store.finishMediaReconcile({
      mediaPhase,
      roomFate: mediaRoomFate(6_000),
      roomVacancy: nextRoomVacancy,
      seen: null,
      ...claim.fence,
      absenceProof: proven
        ? await store.prepareMediaAbsenceProof(claim.fence)
        : null,
      clean: proven,
    });
  };
  const session = async () => {
    const [row] = await fixture.sql.unsafe(
      `select room_name, ended_at, post_round_call_opened_at as opened_at,
         room_vacant_since as vacant_since from media_sessions where id=$1`,
      [binding.sessionId],
    );
    return row as {
      room_name: string;
      ended_at: Date | null;
      opened_at: Date | null;
      vacant_since: Date | null;
    };
  };
  const cleanup = () =>
    fixture.sql.unsafe('delete from media_sessions where id=$1', [
      binding.sessionId,
    ]);
  return { store, binding, bind, pass, session, cleanup };
}

test('the call’s room exists only once the Round’s room is proven gone', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const round = await completedRound(fixture, true);
    try {
      const unproven = await round.pass(false);
      const waiting = await round.session();
      assert({
        given:
          'a completed Round with the call chosen, its room not yet proven absent',
        should: 'keep the session on that room, the call unopened',
        actual: [
          unproven.fate.kind,
          waiting.room_name === round.binding.roomName,
          waiting.opened_at,
          waiting.ended_at,
        ],
        expected: ['keep', true, null, null],
      });
      await assertRejects({
        given: 'an admission while the call is still opening',
        should: 'ask the caller to come back, binding nothing new',
        actual: () => round.bind(),
        code: 'INFRASTRUCTURE',
      });
      const proven = await round.pass(true);
      const open = await round.session();
      const admitted = await round.bind();
      assert({
        given: 'the Round’s room proven absent',
        should:
          'move the session to a fresh room, stamp the call open and vacant from now, and admit its seat there',
        actual: [
          proven.fate.kind,
          proven.ended,
          open.room_name === round.binding.roomName,
          open.opened_at !== null,
          open.vacant_since !== null,
          open.ended_at,
          admitted.roomName === open.room_name,
        ],
        expected: [
          'open-post-round-call',
          false,
          false,
          true,
          true,
          null,
          true,
        ],
      });
    } finally {
      await round.cleanup();
    }
  });
});

test('an open call ends once its room has stood empty for the grace', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const round = await completedRound(fixture, true);
    try {
      await round.pass(true);
      const early = await round.pass(true);
      await fixture.sql.unsafe(
        "update media_sessions set room_vacant_since=clock_timestamp()-interval '61 seconds' where id=$1",
        [round.binding.sessionId],
      );
      const late = await round.pass(true);
      const ended = await round.session();
      assert({
        given: 'a call empty for a moment, then for over a minute',
        should: 'stay open at first, then end the session',
        actual: [early.ended, late.fate.kind, ended.ended_at !== null],
        expected: [false, 'end', true],
      });
      await assertRejects({
        given: 'an admission after the call ended',
        should: 'refuse it',
        actual: () => round.bind(),
        code: 'CONFLICT',
      });
    } finally {
      await round.cleanup();
    }
  });
});

test('a completed Round whose host did not choose the call ends at once', async () => {
  await withFixture(databaseUrl, async (fixture) => {
    const round = await completedRound(fixture, false);
    try {
      const pass = await round.pass(true);
      const after = await round.session();
      assert({
        given: 'a completed Round with no call, its room proven absent',
        should: 'end the session on the room it had',
        actual: [
          pass.fate.kind,
          after.opened_at,
          after.room_name === round.binding.roomName,
        ],
        expected: ['end', null, true],
      });
    } finally {
      await round.cleanup();
    }
  });
});
