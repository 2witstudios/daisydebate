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
      given: 'a scheduled round against a bot with a human judge',
      should:
        'seat you and the bot opposite, and list the judge without a name',
      actual: {
        self: room?.self,
        opponent: [room?.opponent.side, room?.opponent.bot],
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
          bot: null,
        },
        opponent: ['neg', { level: null }],
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

  test('a scheduled round', () => {
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
        voiceLevel: room?.voiceLevel,
        recording: room?.recording,
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
        voiceLevel: 0,
        recording: false,
      },
    });
  });

  test('ranked and practice', () => {
    assert({
      given: 'the same round, ranked and then practice',
      should: 'give the ranked round no agents and the practice round one',
      actual: [
        liveRoundOf({ ...view, competitionType: 'ranked' }, aff.actorId, origin)
          ?.agents.length,
        room?.agents.map((a) => a.title),
      ],
      expected: [0, ['Assistant']],
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
        { label: 'Starts in', remainingMs: countdown - 4_000 },
      ],
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
      expected: ['cross-ex', 'CX1 · You answer', 'CX1 · You ask'],
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
        'put the affirmative in prep on its prep clock with the 1AR lit, and show the negative waiting on Aff prep',
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
        4,
        { aff: 220_000, neg: 240_000 },
        'waiting',
        'Aff prep',
      ],
    });
  });

  test('after the last speech', () => {
    const closedAt = startOf(rules.length);
    const room = liveRoundOf(
      ran(rules.length, true),
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

  test('a final speech that ran out', () => {
    const room = liveRoundOf(
      ran(rules.length),
      aff.actorId,
      origin + startOf(rules.length) + 120_000,
    );
    assert({
      given:
        'the last speech’s time expired two minutes ago, its interval still open',
      should: 'enter judging with the window counted from the scheduled end',
      actual: [room?.phase, room?.clock],
      expected: [
        'judging',
        { label: 'Judging window', remainingMs: 28 * 60_000 },
      ],
    });
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
