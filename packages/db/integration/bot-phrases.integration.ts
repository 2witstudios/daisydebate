import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { isFinalBotSpeechRefusal } from '../src/bot-publication';
import { closeAbandonedBotLines } from '../src/bot-phrases';
import { readOrderedRoundUtterances } from '../src/round-utterance-projection';
import { captionHeardAtSql } from '../src/spectator-release-sql';
import { sql } from 'drizzle-orm';
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
    /** What a live reader reads now. */
    readonly live: () => Promise<string[]>;
    /** Says a phrase as the worker does: authorized, then written as it starts. */
    readonly say: (
      line: ReturnType<typeof phrase>,
      as?: Awaited<ReturnType<typeof claimAtFloorStart>>['claim'],
    ) => Promise<void>;
    readonly run: Harness['run'];
  }) => Promise<void>,
) =>
  withBotPublication(async ({ operations, target, fixture, run }) => {
    const room = createId();
    await fixture.sql`insert into media_sessions(id,round_id,room_name) values(${createId()},${target.roundId},${room})`;
    const { claim } = await claimAtFloorStart({ operations, target, fixture });
    await work({
      say: async (line, as = claim) => {
        await operations.beginBotPhrase(as.scope, as.token, line, room);
        await operations.revealBotPhrase(as.scope, as.token, line, room);
      },
      live: () =>
        run(async (tx) =>
          (
            await readOrderedRoundUtterances(tx as never, target.roundId, 'all')
          ).map((line) => line.text),
        ),
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

test('a phrase played whole closes complete; the first end stands', async () => {
  await withSpeakingBot(async ({ say, operations, claim, lines }) => {
    const spoken = phrase();
    await say(spoken);
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
  await withSpeakingBot(async ({ say, operations, claim, lines, fixture }) => {
    const invented = phrase();
    await say(invented);
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
      playedMs: 600,
    });
    const [{ heard }] =
      await fixture.sql`select bot_duration_ms as heard from utterances where bot_phrase_id=${invented.phraseId}`;
    assert({
      given: 'a 2 s phrase barged in on after three words, 600 ms in',
      should:
        'mark its line interrupted with those three words only, its length what was heard, so its caption is released then',
      actual: { lines: await lines(), heard },
      expected: {
        lines: [
          { text: 'The affirmative has', complete: true, interrupted: true },
        ],
        heard: 600,
      },
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
    async ({ say, operations, claim, lines, fixture, target }) => {
      const spoken = phrase();
      await say(spoken);
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
  await withSpeakingBot(async ({ say, lines }) => {
    await say(phrase(createId(), 58_500));
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
    async ({ say, operations, claim, room, fixture, target, revision }) => {
      const spoken = phrase();
      await say(spoken);
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
    async ({ say, operations, claim, lines, fixture, target }) => {
      const spoken = phrase();
      await say(spoken);
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
    async ({ say, operations, lines, fixture, target, run }) => {
      const lost = phrase(createId(), 10_000);
      await say(lost);
      // Started 4 s ago: four tenths of its nine words, three whole, could have played.
      await fixture.sql`update utterances set created_at=clock_timestamp()-interval '4 seconds' where bot_phrase_id=${lost.phraseId}`;
      // The worker is lost: its lease lapses and another takes the seat over.
      await fixture.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '1 second' where round_id=${target.roundId}`;
      const next = await operations.claimWorker(target);
      const afterTakeover = await lines();
      const [{ heard }] =
        await fixture.sql`select bot_duration_ms as heard from utterances where bot_phrase_id=${lost.phraseId}`;
      const open = phrase(createId(), 2_000);
      await say(open, next);
      await fixture.sql`update utterances set created_at=clock_timestamp()-interval '5 seconds' where bot_phrase_id=${open.phraseId}`;
      await run((tx) => closeAbandonedBotLines(tx, target.roundId));
      assert({
        given:
          'a nine-word phrase left open 4 s into its 10 s, then a 2 s phrase left open long after it ended',
        should:
          'cut the first to its first three words at takeover, and close the second whole at the freeze',
        actual: {
          afterTakeover,
          heardAboutFourSeconds:
            Number(heard) >= 3_900 && Number(heard) < 5_000,
          final: await lines(),
        },
        expected: {
          afterTakeover: [
            { text: 'The affirmative has', complete: true, interrupted: true },
          ],
          heardAboutFourSeconds: true,
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
    async ({ say, operations, claim, room, fixture, target }) => {
      const spoken = phrase();
      await say(spoken);
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

test('the freeze and the judge read only lines that were said', async () => {
  await withSpeakingBot(async ({ say, operations, claim, room, lines }) => {
    const said = phrase();
    await say(said);
    await operations.endBotPhrase(claim.scope, claim.token, said.phraseId, {
      kind: 'whole',
    });
    await operations.beginBotPhrase(
      claim.scope,
      claim.token,
      { ...phrase(createId(), 2_000, 'Never reached.'), startsInMs: 30_000 },
      room,
    );
    assert({
      given:
        'a said line, and a phrase authorized ahead whose audio never started',
      should: 'hold only the said line for the freeze and its judge',
      actual: (await lines()).map((line) => line.text),
      expected: [TEXT],
    });
  });
});

test('a phrase start writes nothing; its reveal as the audio starts writes it and rings, once (ADR 0122)', async () => {
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
      const authorized = {
        lines: await lines(),
        revision: await revision(),
        doorbells: await doorbells(),
      };
      const revealed = await operations.revealBotPhrase(
        claim.scope,
        claim.token,
        spoken,
        room,
      );
      const again = await operations.revealBotPhrase(
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
      const [row] =
        await fixture.sql`select extract(epoch from (clock_timestamp()-created_at))*1000 as ago from utterances where bot_phrase_id=${spoken.phraseId}`;
      const [stream] =
        await fixture.sql`select state from transcript_segments where round_id=${target.roundId} and round_participant_id=${target.roundParticipantId}`;
      assert({
        given: 'a phrase authorized, revealed twice, then authorized again',
        should:
          'write nothing until its reveal, then one line with exactly its text, dated then, its stream complete, with one revision and doorbell',
        actual: {
          said: [first.said, retry.said],
          authorized,
          reveals: [revealed.revealed, again.revealed],
          lines: await lines(),
          datedNow: Number(row!.ago) >= 0 && Number(row!.ago) < 5_000,
          stream: stream?.state,
          revision: await revision(),
          doorbells: await doorbells(),
        },
        expected: {
          said: [false, true],
          authorized: { lines: [], revision: 0, doorbells: 0 },
          reveals: [true, false],
          lines: [{ text: TEXT, complete: false, interrupted: false }],
          datedNow: true,
          stream: 'complete',
          revision: 1,
          doorbells: 1,
        },
      });
      await assertRejects({
        given: 'a retry under the same phrase id with other words',
        should: 'refuse the conflicting body',
        actual: () =>
          operations.revealBotPhrase(
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

test('a phrase authorized ahead is read by no one until said, and the bot’s history waits for it to close', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, live, run, target }) => {
      const spokenLines = () =>
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
      const never = phrase(createId(), 2_000, 'A sentence never said.');
      for (const ahead of [next, never])
        await operations.beginBotPhrase(
          claim.scope,
          claim.token,
          { ...ahead, startsInMs: 2_000 },
          room,
        );
      const before = await live();
      await operations.revealBotPhrase(claim.scope, claim.token, next, room);
      const whilePlaying = { live: await live(), spoken: await spokenLines() };
      await operations.endBotPhrase(claim.scope, claim.token, next.phraseId, {
        kind: 'whole',
      });
      assert({
        given:
          'two phrases authorized ahead, one never said, the other revealed, played and closed',
        should:
          'read neither before; once said, live readers read it while the bot’s history waits for it to close; never the unsaid one',
        actual: {
          before,
          whilePlaying,
          closed: { live: await live(), spoken: await spokenLines() },
        },
        expected: {
          before: [],
          whilePlaying: {
            live: ['The next sentence, said later.'],
            spoken: [],
          },
          closed: {
            live: ['The next sentence, said later.'],
            spoken: ['The next sentence, said later.'],
          },
        },
      });
    },
  );
});

test('a phrase’s reveal is checked again as its audio starts: a lost floor refuses it', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, live, fixture, target }) => {
      const ahead = phrase();
      await operations.beginBotPhrase(claim.scope, claim.token, ahead, room);
      await fixture.sql`update round_speaking_intervals set ended_at=clock_timestamp(),ended_version=2 where round_id=${target.roundId}`;
      await assertRejects({
        given:
          'a phrase authorized ahead whose floor closed before its audio started',
        should: 'refuse its reveal, so its audio stops',
        actual: () =>
          operations.revealBotPhrase(claim.scope, claim.token, ahead, room),
        code: 'CONFLICT',
      });
      assert({
        given: 'the refused reveal',
        should: 'write no line',
        actual: await live(),
        expected: [],
      });
    },
  );
});

test('a line written ahead fits its segment counting the wait until its audio starts', async () => {
  await withSpeakingBot(async ({ operations, claim, room }) => {
    const late = await operations
      .beginBotPhrase(
        claim.scope,
        claim.token,
        { ...phrase(createId(), 50_000), startsInMs: 10_000 },
        room,
      )
      .catch((error: unknown) => error);
    const [now] = await Promise.all([Date.now()]);
    const lateByStart = await operations
      .beginBotPhrase(
        claim.scope,
        claim.token,
        {
          ...phrase(createId(), 50_000),
          startsAt: new Date(now + 10_000).toISOString(),
        },
        room,
      )
      .catch((error: unknown) => error);
    assert({
      given:
        'a 50 s phrase whose audio starts 10 s from now in a segment with 59 s left, by delay and by fixed start',
      should: 'refuse both as ending past the segment',
      actual: [
        isFinalBotSpeechRefusal(late),
        isFinalBotSpeechRefusal(lateByStart),
      ],
      expected: [true, true],
    });
  });
});

test('a bot caption is released only once its words have all played', async () => {
  await withSpeakingBot(async ({ run }) => {
    const [row] = (await run((tx) =>
      tx.execute(
        sql`select ${captionHeardAtSql({ createdAt: sql`'2026-01-01T00:00:00Z'::timestamptz`, botDurationMs: 2_500 })} as bot, ${captionHeardAtSql({ createdAt: sql`'2026-01-01T00:00:00Z'::timestamptz`, botDurationMs: null })} as captured`,
      ),
    )) as unknown as { bot: Date; captured: Date }[];
    assert({
      given:
        'a bot line dated at its audio start, 2.5 s long, and a captured line',
      should:
        'release the bot caption at its end, and the captured one at its writing',
      actual: [
        new Date(row!.bot).toISOString(),
        new Date(row!.captured).toISOString(),
      ],
      expected: ['2026-01-01T00:00:02.500Z', '2026-01-01T00:00:00.000Z'],
    });
  });
});

test('a reveal dates its line at the audio start it was given, never later than now', async () => {
  await withSpeakingBot(async ({ operations, claim, room, fixture }) => {
    const [{ now }] = await fixture.sql`select clock_timestamp() as now`;
    const earlier = phrase();
    const future = phrase();
    for (const line of [earlier, future])
      await operations.beginBotPhrase(claim.scope, claim.token, line, room);
    const startedAt = new Date(new Date(now).getTime() - 800).toISOString();
    await operations.revealBotPhrase(
      claim.scope,
      claim.token,
      earlier,
      room,
      startedAt,
    );
    await operations.revealBotPhrase(
      claim.scope,
      claim.token,
      future,
      room,
      new Date(new Date(now).getTime() + 60_000).toISOString(),
    );
    const rows =
      await fixture.sql`select bot_phrase_id, created_at, created_at <= clock_timestamp() as said from utterances where bot_phrase_id in (${earlier.phraseId}, ${future.phraseId})`;
    const of = (id: string) =>
      rows.find((row: { bot_phrase_id: string }) => row.bot_phrase_id === id);
    assert({
      given:
        'a reveal that arrived 800 ms after its audio started, and one naming a start still to come',
      should:
        'date the first at its audio start, and the second no later than now',
      actual: [
        new Date(of(earlier.phraseId).created_at).toISOString(),
        of(future.phraseId).said,
      ],
      expected: [startedAt, true],
    });
  });
});

test('a reveal is fenced like its authorization: a phrase that would now end past its segment writes nothing', async () => {
  await withSpeakingBot(
    async ({ operations, claim, room, lines, fixture, target }) => {
      const late = phrase(createId(), 2_000);
      await operations.beginBotPhrase(claim.scope, claim.token, late, room);
      // Its audio started later than authorized: the segment is now due in 1 s.
      await fixture.sql`update round_segments set started_at=clock_timestamp()+interval '1 second'-(duration_ms::bigint+returned_ms)*interval '1 millisecond' where id=${target.segmentId}`;
      const refusal = await operations
        .revealBotPhrase(claim.scope, claim.token, late, room)
        .catch((error: unknown) => error);
      assert({
        given:
          'a 2 s phrase authorized in time whose audio starts 1 s before its segment is due',
        should:
          'refuse its reveal for good, so the speech stops, and write no line',
        actual: {
          final: isFinalBotSpeechRefusal(refusal),
          lines: await lines(),
        },
        expected: { final: true, lines: [] },
      });
    },
  );
});
