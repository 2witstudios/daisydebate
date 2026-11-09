import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { isFinalBotSpeechRefusal } from '../src/bot-publication';
import {
  claimAtFloorStart,
  withBotPublication,
} from './bot-publication.test-support';
setupRitewayBun();
requireTestServices(process.env);

type Harness = Parameters<Parameters<typeof withBotPublication>[0]>[0];
const TEXT = 'The affirmative has not shown any harm at all.';
/** A live speech claim in a session room, with readers for what it authored. */
const withSpeakingBot = (
  work: (bot: {
    readonly fixture: Harness['fixture'];
    readonly operations: Harness['operations'];
    readonly target: Harness['target'];
    readonly claim: Awaited<ReturnType<typeof claimAtFloorStart>>['claim'];
    readonly room: string;
    readonly lines: () => Promise<
      { text: string; complete: boolean; interrupted: boolean }[]
    >;
    readonly revision: () => Promise<number>;
    readonly doorbells: () => Promise<number>;
  }) => Promise<void>,
) =>
  withBotPublication(async ({ operations, target, fixture }) => {
    const room = createId();
    await fixture.sql`insert into media_sessions(id,round_id,room_name) values(${createId()},${target.roundId},${room})`;
    const { claim } = await claimAtFloorStart({ operations, target, fixture });
    await work({
      fixture,
      operations,
      target,
      claim,
      room,
      lines: async () =>
        (
          await fixture.sql`select text,complete,interrupted from utterances where round_id=${target.roundId} order by sequence`
        ).map((row: Record<string, unknown>) => ({ ...row })) as never,
      revision: async () =>
        Number(
          (
            await fixture.sql`select revision from round_transcripts where round_id=${target.roundId}`
          )[0]?.revision ?? 0,
        ),
      doorbells: async () =>
        (
          await fixture.sql`select 1 from outbox where kind='round.transcript-changed' and payload->'ids'->>0=${target.roundId}`
        ).length,
    });
  });
const phrase = (phraseId = createId(), durationMs = 2000, text = TEXT) => ({
  phraseId,
  text,
  durationMs,
});

test('a phrase start authors its line, still arriving, with its stream and doorbell, once (ADR 0122)', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, lines, revision, doorbells, fixture, target }) => {
      const spoken = phrase();
      const first = await operations.beginBotPhrase(
        claim.scope,
        claim.token,
        spoken,
        room,
      );
      const retry = await operations.beginBotPhrase(
        claim.scope,
        claim.token,
        spoken,
        room,
      );
      const [stream] =
        await fixture.sql`select state from transcript_segments where round_id=${target.roundId} and round_participant_id=${target.roundParticipantId}`;
      assert({
        given: 'one phrase started, then the same start retried',
        should:
          'write one line with exactly its text, still arriving, a complete stream, and one revision and doorbell',
        actual: {
          duplicates: [first.duplicate, retry.duplicate],
          lines: await lines(),
          stream: stream?.state,
          revision: await revision(),
          doorbells: await doorbells(),
        },
        expected: {
          duplicates: [false, true],
          lines: [{ text: TEXT, complete: false, interrupted: false }],
          stream: 'complete',
          revision: 1,
          doorbells: 1,
        },
      });
      await assertRejects({
        given: 'a retry under the same phrase id with other words',
        should: 'refuse the conflicting body',
        actual: () =>
          operations.beginBotPhrase(
            claim.scope,
            claim.token,
            { ...spoken, text: 'Other words.' },
            room,
          ),
        code: 'CONFLICT',
      });
    },
  );
});

test('a phrase played whole closes complete; the first end stands', async () => {
  await withSpeakingBot(async ({ operations, claim, room, lines }) => {
    const spoken = phrase();
    await operations.beginBotPhrase(claim.scope, claim.token, spoken, room);
    const ended = await operations.endBotPhrase(
      claim.scope,
      claim.token,
      spoken.phraseId,
      { kind: 'whole' },
    );
    const again = await operations.endBotPhrase(
      claim.scope,
      claim.token,
      spoken.phraseId,
      { kind: 'cut', spoken: 'The' },
    );
    assert({
      given: 'a whole phrase ended, then a late cut for it',
      should: 'close the line complete with its whole text, ignoring the late end',
      actual: { ended, again, lines: await lines() },
      expected: {
        ended: { changed: true },
        again: { changed: false },
        lines: [{ text: TEXT, complete: true, interrupted: false }],
      },
    });
  });
});

test('a cut phrase keeps only the words that played, and can claim no other words', async () => {
  await withSpeakingBot(async ({ operations, claim, room, lines }) => {
    const invented = phrase();
    await operations.beginBotPhrase(claim.scope, claim.token, invented, room);
    await assertRejects({
      given: 'a cut that claims words the phrase never had',
      should: 'refuse it',
      actual: () =>
        operations.endBotPhrase(claim.scope, claim.token, invented.phraseId, {
          kind: 'cut',
          spoken: 'The negative has',
        }),
      code: 'VALIDATION',
    });
    await operations.endBotPhrase(claim.scope, claim.token, invented.phraseId, {
      kind: 'cut',
      spoken: 'The affirmative has',
    });
    assert({
      given: 'a phrase barged in on after three words',
      should: 'mark its line interrupted with those three words only',
      actual: await lines(),
      expected: [
        { text: 'The affirmative has', complete: true, interrupted: true },
      ],
    });
  });
});

test('a phrase that would end past its segment is a final refusal and credits nothing', async () => {
  await withSpeakingBot(async ({ operations, claim, room, lines }) => {
    const refusal = await operations
      .beginBotPhrase(claim.scope, claim.token, phrase(createId(), 59_500), room)
      .catch((error: unknown) => error);
    assert({
      given: 'a 59.5 s phrase starting 1 s into a 60 s segment',
      should: 'refuse it for good, so the speech stops, and author nothing',
      actual: {
        final: isFinalBotSpeechRefusal(refusal),
        lines: await lines(),
      },
      expected: { final: true, lines: [] },
    });
  });
});

test('a lost floor, a changed room or an incident starts nothing', async () => {
  const cases = [
    [
      'a floor that closed',
      (sql: Harness['fixture']['sql'], roundId: string) =>
        sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${roundId}`,
      undefined,
    ],
    ['a room the session left', async () => undefined, 'retired'],
    [
      'a platform incident',
      (sql: Harness['fixture']['sql'], roundId: string) =>
        sql`update rounds set runtime_state=jsonb_set(coalesce(runtime_state,'{}'::jsonb),'{incident}','{"phase":"held"}'::jsonb) where id=${roundId}`,
      undefined,
    ],
  ] as const;
  for (const [given, change, roomName] of cases)
    await withSpeakingBot(async ({ operations, claim, room, lines, fixture, target }) => {
      await change(fixture.sql, target.roundId);
      await assertRejects({
        given,
        should: 'refuse the phrase start',
        actual: () =>
          operations.beginBotPhrase(
            claim.scope,
            claim.token,
            phrase(),
            roomName === undefined ? room : createId(),
          ),
        code: 'CONFLICT',
      });
      assert({
        given,
        should: 'author no line',
        actual: await lines(),
        expected: [],
      });
    });
});

test('an end authenticates its claim even after the lease lapsed, and refuses a stranger', async () => {
  await withSpeakingBot(async ({ operations, claim, room, lines, fixture, target }) => {
    const spoken = phrase();
    await operations.beginBotPhrase(claim.scope, claim.token, spoken, room);
    await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp() where round_id=${target.roundId}`;
    await assertRejects({
      given: 'an end with a token that is not the claim’s',
      should: 'refuse it',
      actual: () =>
        operations.endBotPhrase(claim.scope, 'not-the-token', spoken.phraseId, {
          kind: 'whole',
        }),
      code: 'AUTHORIZATION',
    });
    await operations.endBotPhrase(claim.scope, claim.token, spoken.phraseId, {
      kind: 'cut',
      spoken: 'The affirmative',
    });
    assert({
      given: 'a cut reported just after the claim’s lease lapsed',
      should: 'still mark the line cut where it stopped',
      actual: await lines(),
      expected: [{ text: 'The affirmative', complete: true, interrupted: true }],
    });
  });
});
