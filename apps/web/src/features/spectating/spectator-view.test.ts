import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyRuntimeCheckpoint, type RoundView } from '@daisy/protocol';
import {
  aff,
  at,
  countdown,
  neg,
  origin,
  ran,
  rules,
  startOf,
  view,
} from '../../ui/debate-room/live-round.test-support';
import {
  spectatorAudienceOf,
  spectatorViewOf,
  watchingRoomOf,
} from './spectator-view';

setupRitewayBun();

const host = 'h'.repeat(24);
const hosted = (round: RoundView): RoundView => ({
  ...round,
  viewerIsHost: true,
});

describe('spectatorAudienceOf', () => {
  test('who watches as a spectator today', () => {
    assert({
      given:
        'a seatless host of a live Round, the same host once it ended or was abandoned, a seated host, and a member who does not host (ISSUE-673)',
      should: 'admit only the seatless host of a Round that has not ended',
      actual: [
        spectatorAudienceOf(hosted(ran(1)), host),
        spectatorAudienceOf(hosted({ ...view, status: 'scheduled' }), host),
        spectatorAudienceOf(hosted({ ...view, status: 'completed' }), host),
        spectatorAudienceOf(hosted({ ...view, status: 'abandoned' }), host),
        spectatorAudienceOf(hosted(ran(1)), aff.actorId),
        spectatorAudienceOf({ ...ran(1), viewerIsHost: false }, host),
      ],
      expected: ['host', 'host', null, null, null, null],
    });
  });
});

describe('spectatorViewOf', () => {
  test('the seats', () => {
    const watched = spectatorViewOf(ran(1), origin + startOf(0) + 60_000);
    assert({
      given: 'the affirmative constructive a minute in',
      should:
        'name both debaters by side, the affirmative speaking and the negative listening, with no judge identity',
      actual: watched.seats,
      expected: [
        {
          side: 'affirmative',
          label: 'Sam Reyes',
          bot: false,
          activity: 'speaking',
        },
        {
          side: 'negative',
          label: neg.label,
          bot: true,
          activity: 'listening',
        },
      ],
    });
  });

  test('a speech', () => {
    const watched = spectatorViewOf(ran(1), origin + startOf(0) + 60_000);
    assert({
      given: 'the affirmative constructive a minute in',
      should:
        'be in a speech on its clock, with it now, the next one next and the rest upcoming',
      actual: [
        watched.stage,
        watched.clock,
        watched.speeches.slice(0, 3).map((speech) => speech.state),
        watched.judge,
      ],
      expected: [
        'speech',
        {
          label: `${rules[0]!.key} · ${rules[0]!.label}`,
          remainingMs: rules[0]!.durationMs - 60_000,
        },
        ['now', 'next', 'upcoming'],
        'human',
      ],
    });
  });

  test('the countdown', () => {
    const watched = spectatorViewOf(ran(0), origin + 4_000);
    assert({
      given: 'a started round 4 seconds into its countdown',
      should: 'count down to the first speech, which is next',
      actual: [watched.stage, watched.clock, watched.speeches[0]?.state],
      expected: [
        'countdown',
        { label: 'Starts in', remainingMs: countdown - 4_000 },
        'next',
      ],
    });
  });

  test('cross-examination', () => {
    const watched = spectatorViewOf(ran(2), origin + startOf(1) + 30_000);
    assert({
      given: 'the negative’s cross-examination half a minute in',
      should: 'name who asks and who answers, and mark the first speech done',
      actual: [
        watched.stage,
        watched.clock?.label,
        watched.seats.map((seat) => seat.activity),
        watched.speeches[0]?.state,
      ],
      expected: [
        'cross-ex',
        'Cross-examination · Negative asks',
        ['answering', 'asking'],
        'done',
      ],
    });
  });

  test('prep', () => {
    const prepping: RoundView = {
      ...ran(4, true),
      checkpoint: {
        ...emptyRuntimeCheckpoint,
        active_prep: { side: 'affirmative', started_at: at(startOf(4)) },
      },
    };
    const watched = spectatorViewOf(prepping, origin + startOf(4) + 20_000);
    assert({
      given: 'the affirmative 20 seconds into prep before the 1AR',
      should:
        'show Affirmative prep, the affirmative preparing and the 1AR next',
      actual: [
        watched.stage,
        watched.clock?.label,
        watched.seats.map((seat) => seat.activity),
        watched.speeches[4]?.state,
      ],
      expected: ['prep', 'Affirmative prep', ['preparing', 'waiting'], 'next'],
    });
  });

  test('before the round starts, and an unreadable checkpoint', () => {
    assert({
      given:
        'a scheduled round, then an active one whose checkpoint is unreadable',
      should: 'show it starting with no clock, then waiting with nothing lit',
      actual: [
        [
          spectatorViewOf(view, origin).stage,
          spectatorViewOf(view, origin).clock,
        ],
        [
          spectatorViewOf({ ...ran(1), checkpoint: null }, origin).stage,
          spectatorViewOf({ ...ran(1), checkpoint: null }, origin).clock,
          spectatorViewOf(
            { ...ran(1), checkpoint: null },
            origin,
          ).speeches.some((speech) => speech.state !== 'upcoming'),
        ],
      ],
      expected: [
        ['starting', null],
        ['between', null, false],
      ],
    });
  });

  test('after the last speech', () => {
    const watched = spectatorViewOf(
      ran(rules.length, true),
      origin + startOf(rules.length) + 10_000,
    );
    assert({
      given: 'every speech closed and the judge deciding',
      should: 'be judging, every speech done, no clock',
      actual: [
        watched.stage,
        watched.clock,
        watched.speeches.every((speech) => speech.state === 'done'),
      ],
      expected: ['judging', null, true],
    });
  });
});

describe('watchingRoomOf', () => {
  test('the room route sends a host who also judges to the judge room (ISSUE-673)', () => {
    const judging = ran(1);
    assert({
      given:
        'a seatless host assigned as the live judge, the same once the Round ended, a seatless host who does not judge, and a member with neither',
      should:
        'judge first, then fall back to the receipt; watch as a spectator; and otherwise show the receipt',
      actual: [
        watchingRoomOf({
          judgeRound: judging,
          audience: spectatorAudienceOf(hosted(judging), host),
        }).kind,
        watchingRoomOf({
          judgeRound: { ...judging, status: 'completed' },
          audience: 'host',
        }).kind,
        watchingRoomOf({
          judgeRound: null,
          audience: spectatorAudienceOf(hosted(judging), host),
        }).kind,
        watchingRoomOf({ judgeRound: null, audience: null }).kind,
      ],
      expected: ['judge', 'receipt', 'spectator', 'receipt'],
    });
  });
});
