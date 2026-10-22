import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createMediaSessionStore } from '../src/media-session';
import { withFixture, rejectedBy } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('concurrent media admission reuses one opaque session and seat identity', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date('2026-10-22T05:00:00Z'),
    });
    const seat = await fixture.seat(roundId, 'affirmative');
    const store = createMediaSessionStore({ url, nextId: createId });
    try {
      const bindings = await Promise.all(
        Array.from({ length: 5 }, () =>
          store.ensureBinding({ roundId, roundParticipantId: seat.id }),
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
    } finally {
      const [table] =
        await fixture.sql`select to_regclass('public.media_sessions') as name`;
      if (table?.name)
        await fixture.sql.unsafe(
          'delete from media_sessions where round_id = $1',
          [roundId],
        );
      await store.close();
    }
  });
});

test('terminal and wrong-seat admission cannot create a media session', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const seat = await fixture.seat(roundId, 'affirmative');
    const otherRoundId = await fixture.round();
    const store = createMediaSessionStore({ url, nextId: createId });
    try {
      await assertRejects({
        given: 'a participant whose seat belongs to another Round',
        should: 'refuse before creating either media row',
        actual: () =>
          store.ensureBinding({
            roundId: otherRoundId,
            roundParticipantId: seat.id,
          }),
        code: 'NOT_FOUND',
      });
      await fixture.sql.unsafe(
        "update rounds set status = 'abandoned', completed_at = statement_timestamp() where id = $1",
        [roundId],
      );
      await assertRejects({
        given: 'a Round that committed abandonment',
        should: 'deny media admission immediately',
        actual: () =>
          store.ensureBinding({ roundId, roundParticipantId: seat.id }),
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
      await store.close();
    }
  });
});
