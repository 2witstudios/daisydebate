import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, type RoundView } from '@daisy/protocol';
import { isLiveDebater, liveRoundOf } from './live-round';
import {
  aff,
  at,
  countdown,
  judge,
  neg,
  origin,
  ran,
  rules,
  startOf,
  unjudgedClosed,
  view,
} from './live-round.test-support';

setupRitewayBun();

describe('isLiveDebater', () => {
  test('who the round room is for', () => {
    assert({
      given: 'a debater, the judge, a stranger, and the debater once ended',
      should: 'admit only the debater of a round that has not ended',
      actual: [
        isLiveDebater(view, aff.actorId),
        isLiveDebater(view, judge.actorId),
        isLiveDebater(view, 'x'.repeat(24)),
        isLiveDebater({ ...view, status: 'completed' }, aff.actorId),
        isLiveDebater({ ...view, status: 'abandoned' }, aff.actorId),
      ],
      expected: [true, false, false, false, false],
    });
  });
});

describe('liveRoundOf before the start', () => {
  const room = liveRoundOf(view, aff.actorId, origin);
  const first = rules[0]!;

  test('the debaters and the anonymous judge', () => {
    assert({
      given: 'a new round against a bot with a human judge',
      should:
        'seat you and the bot opposite, and list the judge without a name',
      actual: {
        self: room?.self,
        opponent: room?.opponent.side,
        judge: room?.judge,
        ballots: room?.ballots,
        names: room?.people.map((p) => `${p.role}:${p.name}:${p.bot}`),
        leaked: JSON.stringify(room).includes('Riley'),
      },
      expected: {
        self: {
          id: aff.actorId,
          name: 'Sam Reyes',
          initials: 'SR',
          side: 'aff',
          rating: null,
        },
        opponent: 'neg',
        judge: 'human',
        ballots: { judge: 'human', ai: null },
        names: [
          'aff:Sam Reyes:false',
          'neg:Practice bot:true',
          'judge:Judge:false',
        ],
        leaked: false,
      },
    });
  });

  test('a new round', () => {
    assert({
      given: 'a round whose clock has not started',
      should:
        'light no speech, show the first speech’s length and full prep, close the mic and record nothing',
      actual: {
        phase: room?.phase,
        liveIndex: room?.liveIndex,
        clock: room?.clock,
        prepMs: room?.prepMs,
        micLive: room?.micLive,
      },
      expected: {
        phase: 'waiting',
        liveIndex: -1,
        clock: {
          label: `${first.key} · ${first.label}`,
          remainingMs: first.durationMs,
        },
        prepMs: { aff: 240_000, neg: 240_000 },
        micLive: false,
      },
    });
  });

  test('ranked and casual', () => {
    assert({
      given: 'the same round, ranked and then casual',
      should: 'offer the same assistant in both',
      actual: [
        liveRoundOf(
          { ...view, competitionType: 'ranked' },
          aff.actorId,
          origin,
        )?.agents.map((a) => a.title),
        room?.agents.map((a) => a.title),
      ],
      expected: [['Assistant'], ['Assistant']],
    });
  });

  test('outside the room', () => {
    assert({
      given: 'the judge, and a round with no opponent seated',
      should: 'give no room',
      actual: [
        liveRoundOf(view, judge.actorId, origin),
        liveRoundOf(
          { ...view, participants: [view.participants[0]!] },
          aff.actorId,
          origin,
        ),
      ],
      expected: [null, null],
    });
  });
});

describe('liveRoundOf during the round', () => {
  test('the countdown', () => {
    const room = liveRoundOf(ran(0), aff.actorId, origin + 4_000);
    assert({
      given: 'a started round 4 seconds into its countdown',
      should: 'wait, light the first speech and count down to it',
      actual: [room?.phase, room?.liveIndex, room?.clock],
      expected: [
        'waiting',
        0,
        {
          label: 'Starts in',
          remainingMs: countdown - 4_000,
          note: 'Your microphone goes live just before your clock starts.',
        },
      ],
    });
  });

  test('who is told their microphone is about to open', () => {
    const NOTE = 'Your microphone goes live just before your clock starts.';
    const human = { ...neg, kind: 'human' as const };
    const partner = {
      ...aff,
      id: 'p4n6p8r2t4v6x8z1k3b5c7d9',
      actorId: 'q4n6p8r2t4v6x8z1k3b5c7d9',
      slot: 1,
    };
    const seated = (
      closed: number,
      over: Partial<RoundView> = {},
    ): RoundView => ({
      ...ran(closed, true),
      participants: [{ ...aff, label: 'Sam Reyes' }, human, partner],
      ...over,
    });
    const notes = (round: RoundView, sequence: number) =>
      [aff, human, partner].map(
        ({ actorId }) =>
          liveRoundOf(round, actorId, origin + startOf(sequence) + 1_000)?.clock
            ?.note === NOTE,
      );
    const types = rules.map(({ type }) => type);
    const crossEx = types.indexOf('cross_ex');
    const speech = types.indexOf('speech', crossEx);
    assert({
      given:
        'the gap before a speech, in a team with a partner in another slot',
      should: 'tell only the seat that speaks, never its partner',
      actual: notes(seated(speech), speech),
      expected: [
        rules[speech]!.side === 'affirmative' && rules[speech]!.slot === 0,
        rules[speech]!.side === 'negative',
        false,
      ],
    });
    assert({
      given: 'the gap before a cross-examination',
      should: 'tell every debater whose microphone opens, on both sides',
      actual: notes(seated(crossEx), crossEx).slice(0, 2),
      expected: [true, true],
    });
    const open = seated(speech);
    assert({
      given: 'the gap before a speech under open questioning',
      should: 'tell both sides, because everyone may speak',
      actual: notes(
        {
          ...open,
          rules: {
            ...open.rules,
            interaction: {
              ...open.rules.interaction,
              interruptions: {
                ...open.rules.interaction.interruptions,
                allowed: 'open',
              } as never,
            },
          },
        },
        speech,
      ).slice(0, 2),
      expected: [true, true],
    });
  });

  test('a seat in its own prep is told its microphone opens when prep ends', () => {
    const closed = rules.findIndex(
      ({ type, side }, index) =>
        index > 0 && type === 'speech' && side === 'affirmative',
    );
    const prepping: RoundView = {
      ...ran(closed, true),
      checkpoint: {
        ...emptyRuntimeCheckpoint,
        active_prep: { side: 'affirmative', started_at: at(startOf(closed)) },
      },
    };
    const clock = liveRoundOf(
      prepping,
      aff.actorId,
      origin + startOf(closed) + 1_000,
    )?.clock;
    assert({
      given: 'the next speaker in their own prep',
      should: 'say the microphone goes live when prep ends',
      actual: [clock?.label, clock?.note],
      expected: ['Your prep', 'Your microphone goes live when this prep ends.'],
    });
  });

  test('a speech, from both sides', () => {
    const now = origin + startOf(0) + 60_000;
    const mine = liveRoundOf(ran(1), aff.actorId, now);
    const theirs = liveRoundOf(ran(1), neg.actorId, now);
    assert({
      given: 'the affirmative constructive a minute in',
      should:
        'give the affirmative its own speech with a live mic and the negative the opponent’s speech with a closed one',
      actual: [
        mine?.phase,
        mine?.micLive,
        mine?.liveIndex,
        mine?.clock,
        theirs?.phase,
        theirs?.micLive,
      ],
      expected: [
        'own-speech',
        true,
        0,
        {
          label: `${rules[0]!.key} · ${rules[0]!.label}`,
          remainingMs: rules[0]!.durationMs - 60_000,
        },
        'opponent-speaking',
        false,
      ],
    });
  });

  test('cross-examination', () => {
    const now = origin + startOf(1) + 30_000;
    assert({
      given: 'the negative’s cross-examination half a minute in',
      should: 'put both in cross-ex, the affirmative answering',
      actual: [
        liveRoundOf(ran(2), aff.actorId, now)?.phase,
        liveRoundOf(ran(2), aff.actorId, now)?.clock?.label,
        liveRoundOf(ran(2), neg.actorId, now)?.clock?.label,
      ],
      expected: [
        'cross-ex',
        'Cross-examination · You answer',
        'Cross-examination · You ask',
      ],
    });
  });

  test('pre-round prep', () => {
    const endsAt = at(1_200_000);
    const room = liveRoundOf(
      {
        ...view,
        status: 'opening',
        startedAt: null,
        segments: [],
        opening: {
          step: {
            step: 'prep',
            startedAt: at(0),
            endsAt,
            remainingMs: 1_200_000,
          },
          draw: null,
          canStrike: false,
        },
      },
      aff.actorId,
      origin + 200_000,
    );
    assert({
      given: 'a debater 200 seconds into pre-round prep',
      should:
        'put them in prep on the time left, with no speech lit and the mic closed',
      actual: [room?.phase, room?.liveIndex, room?.clock, room?.micLive],
      expected: ['prep', -1, { label: 'Prep', remainingMs: 1_000_000 }, false],
    });
  });

  test('prep', () => {
    const now = origin + startOf(4) + 20_000;
    const prepping: RoundView = {
      ...ran(4, true),
      checkpoint: {
        ...emptyRuntimeCheckpoint,
        active_prep: { side: 'affirmative', started_at: at(startOf(4)) },
      },
    };
    const mine = liveRoundOf(prepping, aff.actorId, now);
    const theirs = liveRoundOf(prepping, neg.actorId, now);
    assert({
      given: 'the affirmative 20 seconds into prep before the 1AR',
      should:
        'put the affirmative in prep on its prep clock with the 1AR lit, and show the negative waiting on Affirmative prep',
      actual: [
        mine?.phase,
        mine?.clock,
        mine?.liveIndex,
        mine?.prepMs,
        theirs?.phase,
        theirs?.clock?.label,
      ],
      expected: [
        'prep',
        { label: 'Your prep', remainingMs: 220_000 },
          note: 'Your microphone goes live when this prep ends.',
        4,
        { aff: 220_000, neg: 240_000 },
        'waiting',
        'Affirmative prep',
      ],
    });
  });

  test('after the last speech', () => {
    const closedAt = startOf(rules.length);
    const room = liveRoundOf(
      {
        ...ran(rules.length, true),
        waitingOn: {
          state: 'human_window',
          // The deadline the server persisted at the freeze, never recomputed here.
          deadlineAt: new Date(origin + closedAt + 30 * 60_000).toISOString(),
        },
      },
      aff.actorId,
      origin + closedAt + 60_000,
    );
    assert({
      given: 'every speech closed a minute ago and no outcome yet',
      should:
        'enter judging with every speech past, the window clock 29 minutes from its end and closed mics',
      actual: [room?.phase, room?.liveIndex, room?.clock, room?.micLive],
      expected: [
        'judging',
        rules.length,
        { label: 'Judging window', remainingMs: 29 * 60_000 },
        false,
      ],
    });
  });

  test('after the last speech with no judge seat', () => {
    const room = liveRoundOf(
      unjudgedClosed(),
      aff.actorId,
      origin + startOf(rules.length) + 60_000,
    );
    assert({
      given: 'a zero-judge Round whose speeches closed a minute ago',
      should: 'close the speeches with no judge, ballots or judging clock',
      actual: [room?.phase, room?.judge, room?.ballots, room?.clock],
      expected: ['judging', null, null, null],
    });
  });

  test('a final speech that ran out', () => {
    const room = liveRoundOf(
      ran(rules.length),
      aff.actorId,
      origin + startOf(rules.length) + 120_000,
    );
    assert({
      given:
        'the last speech’s time expired two minutes ago, its interval still open',
      should:
        'enter judging with no invented window before the server names one',
      actual: [room?.phase, room?.clock],
      expected: ['judging', null],
    });
  });

  test('an AI judge has no human countdown', () => {
    const closedAt = startOf(rules.length);
    for (const state of ['ai_processing', 'ai_failed'] as const) {
      const room = liveRoundOf(
        {
          ...ran(rules.length, true),
          waitingOn:
            state === 'ai_processing'
              ? {
                  state,
                  deadlineAt: new Date(
                    origin + closedAt + 300_000,
                  ).toISOString(),
                }
              : { state },
        },
        aff.actorId,
        origin + closedAt + 60_000,
      );
      assert({
        given: `the server reporting ${state}`,
        should: 'carry that state and show no judging window',
        actual: [room?.phase, room?.clock, room?.judgingState],
        expected: ['judging', null, state],
      });
    }
  });

  test('an unreadable checkpoint', () => {
    const room = liveRoundOf(
      { ...ran(1), checkpoint: null },
      aff.actorId,
      origin + startOf(0) + 60_000,
    );
    assert({
      given: 'an active round whose stored checkpoint could not be read',
      should:
        'still open the room, waiting with nothing lit, no clock and no prep, rather than guess',
      actual: [room?.phase, room?.liveIndex, room?.clock, room?.prepMs],
      expected: ['waiting', -1, null, null],
    });
  });
});
