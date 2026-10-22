import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaSessionStore } from '../src/media-session';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createBoundedTransaction } from '../src/bounded-transaction';
import type { LockedRoundTickInput } from '../src/round-clock-transaction';
import { withFixture, rejectedBy } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const buildProjection: LockedRoundTickInput['buildProjection'] = ({
  round,
}) => ({
  round: {
    status: round.status,
    currentStage: round.currentStage,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    outcome: round.outcome,
    checkpoint: round.checkpoint,
  },
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
});
const storeFor = (
  client: Parameters<typeof createBoundedTransaction>[0]['client'],
) =>
  createMediaSessionStore({
    database: drizzle({ client }),
    run: createBoundedTransaction({
      client,
      maxConnections: 10,
      now: performance.now,
    }),
    nextId: createId,
  });

test('concurrent media admission reuses one opaque session and seat identity', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-22T05:00:00Z'),
    });
    const seat = await fixture.seat(roundId, 'affirmative');
    const store = storeFor(fixture.sql);
    await fixture.sql.unsafe(
      'update users set email_verified=true where id=(select user_id from actors where id=$1)',
      [seat.actorId],
    );
    try {
      const bindings = await Promise.all(
        Array.from({ length: 5 }, () =>
          store.ensureBinding({
            roundId,
            actorId: seat.actorId,
            buildProjection,
          }),
        ),
      );
      assert({
        given: 'five concurrent admissions for the same Round seat',
        should: 'reuse the opaque session, room and media identity',
        actual: new Set(bindings.map((binding) => JSON.stringify(binding)))
          .size,
        expected: 1,
      });
      const first = bindings[0]!;
      assert({
        given: 'an opaque media identity',
        should: 'resolve to its authoritative Round seat',
        actual: await store.findBinding({
          sessionId: first.sessionId,
          identity: first.identity,
        }),
        expected: first,
      });
      const otherRoundId = await fixture.round({
        status: 'active',
        current_stage: 'live',
        started_at: new Date('2026-10-22T05:00:00Z'),
      });
      const otherSeat = await fixture.seat(otherRoundId, 'negative');
      assert({
        given: 'a seat from another Round attached to this media session',
        should: 'refuse the cross-Round binding at the database boundary',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe(
            'insert into media_participants (id, session_id, round_id, round_participant_id, identity) values ($1, $2, $3, $4, $5)',
            [createId(), first.sessionId, roundId, otherSeat.id, createId()],
          ),
        ),
        expected: 'media_participants_participant_round_fk',
      });
      assert({
        given: 'the owning Round is deleted with its media seat binding',
        should:
          'cascade dependent media rows before checking the seat reference',
        actual: await rejectedBy(() =>
          fixture.sql.unsafe('delete from rounds where id=$1', [roundId]),
        ),
        expected: null,
      });
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.media_sessions') as name`;
      if (table?.name)
        await fixture.sql.unsafe(
          'delete from media_sessions where round_id = $1',
          [roundId],
        );
    }
  });
});

test('terminal and wrong-seat admission cannot create a media session', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seat = await fixture.seat(roundId, 'affirmative');
    const otherRoundId = await fixture.round();
    const store = storeFor(fixture.sql);
    await fixture.sql.unsafe(
      'update users set email_verified=true where id=(select user_id from actors where id=$1)',
      [seat.actorId],
    );
    try {
      await assertRejects({
        given: 'a participant whose seat belongs to another Round',
        should: 'refuse before creating either media row',
        actual: () =>
          store.ensureBinding({
            roundId: otherRoundId,
            actorId: seat.actorId,
            buildProjection,
          }),
        code: 'AUTHORIZATION',
      });
      await fixture.sql.unsafe(
        "update rounds set status = 'abandoned', completed_at = statement_timestamp() where id = $1",
        [roundId],
      );
      await assertRejects({
        given: 'a Round that committed abandonment',
        should: 'deny media admission immediately',
        actual: () =>
          store.ensureBinding({
            roundId,
            actorId: seat.actorId,
            buildProjection,
          }),
        code: 'CONFLICT',
      });
      assert({
        given: 'both refused admissions',
        should: 'leave session storage unchanged',
        actual:
          (await fixture.count('media_sessions', 'round_id', roundId)) +
          (await fixture.count('media_sessions', 'round_id', otherRoundId)),
        expected: 0,
      });
    } finally {
      await fixture.sql.unsafe('delete from media_sessions where round_id=$1', [
        roundId,
      ]);
    }
  });
});

test('fresh canonical revocation and actual final-end expiry refuse repeated binding', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date(),
    });
    const seat = await fixture.seat(roundId, 'affirmative');
    await fixture.sql.unsafe(
      'update users set email_verified=true where id=(select user_id from actors where id=$1)',
      [seat.actorId],
    );
    const store = storeFor(fixture.sql);
    const input = { roundId, actorId: seat.actorId, buildProjection };
    try {
      const binding = await store.ensureBinding(input);
      await fixture.sql.unsafe(
        'update users set email_verified=false where id=(select user_id from actors where id=$1)',
        [seat.actorId],
      );
      await assertRejects({
        given: 'revoked canonical membership after the first binding',
        should: 'deny even an existing opaque binding',
        actual: () => store.ensureBinding(input),
        code: 'AUTHORIZATION',
      });
      await fixture.sql.unsafe(
        'update users set email_verified=true where id=(select user_id from actors where id=$1)',
        [seat.actorId],
      );
      await fixture.sql.unsafe(
        "update rounds set final_segment_ended_at=statement_timestamp()-interval '30 minutes', transcript_admission_cutoff=statement_timestamp()-interval '28 minutes' where id=$1",
        [roundId],
      );
      await assertRejects({
        given: 'actual final end more than thirty minutes ago',
        should: 'refuse before minting even though status is still active',
        actual: () => store.ensureBinding(input),
        code: 'CONFLICT',
      });
      assert({
        given: 'refused repeat admission',
        should: 'retain the original binding without making another identity',
        actual: await store.findBinding({
          sessionId: binding.sessionId,
          identity: binding.identity,
        }),
        expected: binding,
      });
    } finally {
      await fixture.sql.unsafe('delete from media_sessions where round_id=$1', [
        roundId,
      ]);
    }
  });
});
