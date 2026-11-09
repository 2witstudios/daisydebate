import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { isFinalBotSpeechRefusal } from '../src/bot-publication';
import { closeAbandonedBotLines } from '../src/bot-phrases';
import { readOrderedRoundUtterances } from '../src/round-utterance-projection';
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
    readonly run: Harness['run'];
  }) => Promise<void>,
) =>
  withBotPublication(async ({ operations, target, fixture, run }) => {
    const room = createId();
    await fixture.sql`insert into media_sessions(id,round_id,room_name) values(${createId()},${target.roundId},${room})`;
    const { claim } = await claimAtFloorStart({ operations, target, fixture });
    await work({
      run,
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
    async ({
      operations,
      claim,
      room,
      lines,
      revision,
      doorbells,
      fixture,
      target,
    }) => {
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
      should:
        'close the line complete with its whole text, ignoring the late end',
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
      .beginBotPhrase(
        claim.scope,
        claim.token,
        phrase(createId(), 60_000),
        room,
      )
      .catch((error: unknown) => error);
    assert({
      given: 'a 60 s phrase starting 1 s into a 60 s segment',
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
    await withSpeakingBot(
      async ({ operations, claim, room, lines, fixture, target }) => {
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
      },
    );
});

test('an end authenticates its claim even after the lease lapsed, and refuses a stranger', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, lines, fixture, target }) => {
      const spoken = phrase();
      await operations.beginBotPhrase(claim.scope, claim.token, spoken, room);
      await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp() where round_id=${target.roundId}`;
      await assertRejects({
        given: 'an end with a token that is not the claim’s',
        should: 'refuse it',
        actual: () =>
          operations.endBotPhrase(
            claim.scope,
            'not-the-token',
            spoken.phraseId,
            {
              kind: 'whole',
            },
          ),
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
        expected: [
          { text: 'The affirmative', complete: true, interrupted: true },
        ],
      });
    },
  );
});

test('a phrase that ends just before its segment is due is written', async () => {
  await withSpeakingBot(async ({ operations, claim, room, lines }) => {
    await operations.beginBotPhrase(
      claim.scope,
      claim.token,
      phrase(createId(), 58_500),
      room,
    );
    assert({
      given: 'a 58.5 s phrase starting about 1 s into a 60 s segment',
      should: 'author its line',
      actual: (await lines()).length,
      expected: 1,
    });
  });
});

test('a frozen transcript takes no phrase start and no phrase end', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, fixture, target, revision }) => {
      const spoken = phrase();
      await operations.beginBotPhrase(claim.scope, claim.token, spoken, room);
      await fixture.sql`insert into round_transcript_freezes(round_id,revision,frontier,completeness) values(${target.roundId},1,${await revision()},'complete')`;
      await assertRejects({
        given: 'a phrase start after the freeze, the floor still open',
        should: 'refuse it',
        actual: () =>
          operations.beginBotPhrase(claim.scope, claim.token, phrase(), room),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'a phrase end after the freeze',
        should: 'refuse it, leaving the frozen line as it was',
        actual: () =>
          operations.endBotPhrase(claim.scope, claim.token, spoken.phraseId, {
            kind: 'whole',
          }),
        code: 'CONFLICT',
      });
    },
  );
});

test('a phrase cut before its first word leaves no line', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, lines, fixture, target }) => {
      const spoken = phrase();
      await operations.beginBotPhrase(claim.scope, claim.token, spoken, room);
      await operations.endBotPhrase(claim.scope, claim.token, spoken.phraseId, {
        kind: 'cut',
        spoken: '',
      });
      const again = await operations.endBotPhrase(
        claim.scope,
        claim.token,
        spoken.phraseId,
        { kind: 'whole' },
      );
      const streams =
        await fixture.sql`select 1 from transcript_segments where round_id=${target.roundId} and round_participant_id=${target.roundParticipantId}`;
      assert({
        given:
          'a bot’s only phrase barged in on before a word was heard, then a late end',
        should:
          'delete its line and the stream it made complete, so the turn stays owed, and take the late end as a no-op',
        actual: { lines: await lines(), streams: streams.length, again },
        expected: { lines: [], streams: 0, again: { changed: false } },
      });
    },
  );
});

test('a line its worker never closed keeps only what could have played, at takeover and at the freeze', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, lines, fixture, target, run }) => {
      const lost = phrase(createId(), 10_000);
      await operations.beginBotPhrase(claim.scope, claim.token, lost, room);
      // Started 4 s ago: four tenths of its nine words, three whole, could have played.
      await fixture.sql`update utterances set created_at=clock_timestamp()-interval '4 seconds' where bot_phrase_id=${lost.phraseId}`;
      // The worker is lost: its lease lapses and another takes the seat over.
      await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${target.roundId}`;
      const next = await operations.claimWorker(target);
      const afterTakeover = await lines();
      const open = phrase(createId(), 2_000);
      await operations.beginBotPhrase(next.scope, next.token, open, room);
      await fixture.sql`update utterances set created_at=clock_timestamp()-interval '5 seconds' where bot_phrase_id=${open.phraseId}`;
      await run((tx) => closeAbandonedBotLines(tx, target.roundId));
      assert({
        given:
          'a nine-word phrase left open 4 s into its 10 s, then a 2 s phrase left open long after it ended',
        should:
          'cut the first to its first three words at takeover, and close the second whole at the freeze',
        actual: { afterTakeover, final: await lines() },
        expected: {
          afterTakeover: [
            { text: 'The affirmative has', complete: true, interrupted: true },
          ],
          final: [
            { text: 'The affirmative has', complete: true, interrupted: true },
            { text: TEXT, complete: true, interrupted: false },
          ],
        },
      });
    },
  );
});

test('an exact retry of a phrase start is checked like the first: a closed floor refuses it', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, fixture, target }) => {
      const spoken = phrase();
      await operations.beginBotPhrase(claim.scope, claim.token, spoken, room);
      await fixture.sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${target.roundId}`;
      await assertRejects({
        given: 'the same phrase start retried after the floor closed',
        should: 'refuse it, so a retry never plays on authority it lost',
        actual: () =>
          operations.beginBotPhrase(claim.scope, claim.token, spoken, room),
        code: 'CONFLICT',
      });
    },
  );
});

test('a line written ahead is dated by when its audio starts, and fits with that wait', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, fixture, target }) => {
      const ahead = phrase(createId(), 2_000);
      await operations.beginBotPhrase(
        claim.scope,
        claim.token,
        { ...ahead, startsInMs: 5_000 },
        room,
      );
      const [row] =
        await fixture.sql`select extract(epoch from (created_at - clock_timestamp()))*1000 as ahead_ms from utterances where bot_phrase_id=${ahead.phraseId}`;
      const late = await operations
        .beginBotPhrase(
          claim.scope,
          claim.token,
          { ...phrase(createId(), 50_000), startsInMs: 10_000 },
          room,
        )
        .catch((error: unknown) => error);
      void target;
      assert({
        given:
          'a 2 s line written 5 s ahead, then a 50 s phrase starting 10 s from now in a segment with 59 s left',
        should:
          'date the first by its playout, and refuse the second as ending past the segment',
        actual: {
          datedAhead: Number(row!.ahead_ms) > 4_000,
          refusedFinal: isFinalBotSpeechRefusal(late),
        },
        expected: { datedAhead: true, refusedFinal: true },
      });
    },
  );
});

test('a line written ahead stays unread until its audio starts, and one withdrawn is never read (ADR 0122)', async () => {
  await withSpeakingBot(async ({ operations, claim, room, run, target }) => {
    const live = () =>
      run(async (tx) =>
        (
          await readOrderedRoundUtterances(tx as never, target.roundId, 'live')
        ).map((line) => line.text),
      );
    const spoken = () =>
      run(async (tx) =>
        (
          await readOrderedRoundUtterances(
            tx as never,
            target.roundId,
            'spoken',
          )
        ).map((line) => line.text),
      );
    const next = phrase(createId(), 2_000, 'The next sentence, said later.');
    await operations.beginBotPhrase(
      claim.scope,
      claim.token,
      { ...next, startsInMs: 400 },
      room,
    );
    const withdrawn = phrase(createId(), 2_000, 'A sentence never said.');
    await operations.beginBotPhrase(
      claim.scope,
      claim.token,
      { ...withdrawn, startsInMs: 400 },
      room,
    );
    const before = { live: await live(), spoken: await spoken() };
    // The barge-in comes before it starts: it is withdrawn, never said.
    await operations.endBotPhrase(
      claim.scope,
      claim.token,
      withdrawn.phraseId,
      {
        kind: 'cut',
        spoken: '',
      },
    );
    await Bun.sleep(500);
    assert({
      given:
        'two lines written 400 ms ahead of their audio, one then withdrawn before it starts',
      should:
        'show neither to a live reader or the bot before they start, then only the one said',
      actual: { before, after: { live: await live(), spoken: await spoken() } },
      expected: {
        before: { live: [], spoken: [] },
        after: {
          live: ['The next sentence, said later.'],
          spoken: ['The next sentence, said later.'],
        },
      },
    });
  });
});

test('the freeze and the judge read only lines that started', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, run, target, lines }) => {
      const said = phrase();
      await operations.beginBotPhrase(claim.scope, claim.token, said, room);
      await operations.endBotPhrase(claim.scope, claim.token, said.phraseId, {
        kind: 'whole',
      });
      await operations.beginBotPhrase(
        claim.scope,
        claim.token,
        { ...phrase(createId(), 2_000, 'Never reached.'), startsInMs: 30_000 },
        room,
      );
      // As the freeze does before it reads its frontier.
      await run((tx) => closeAbandonedBotLines(tx, target.roundId));
      assert({
        given: 'a said line and one written ahead whose audio never started',
        should: 'leave only the said line for the freeze and its judge',
        actual: (await lines()).map((line) => line.text),
        expected: [TEXT],
      });
    },
  );
});

test('a line written ahead is dated by the start the worker fixed, not by when it commits', async () => {
  await withSpeakingBot(async ({ operations, claim, room, fixture }) => {
    const [{ now }] = await fixture.sql`select clock_timestamp() as now`;
    const startsAt = new Date(new Date(now).getTime() + 3_000).toISOString();
    const ahead = phrase(createId(), 2_000);
    await operations.beginBotPhrase(
      claim.scope,
      claim.token,
      { ...ahead, startsAt },
      room,
    );
    const [row] =
      await fixture.sql`select created_at from utterances where bot_phrase_id=${ahead.phraseId}`;
    assert({
      given:
        'a line written ahead with its audio start fixed on the database clock',
      should: 'date it exactly there, however long its start took to commit',
      actual: new Date(row!.created_at).toISOString(),
      expected: startsAt,
    });
  });
});
