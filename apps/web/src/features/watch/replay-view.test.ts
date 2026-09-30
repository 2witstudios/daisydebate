import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { watchViewer } from './debate-source';
import { openReplay } from './open-replay';
import { defaultReplayQuery, type ReplayQuery } from './replay-query';

setupRitewayBun();

const viewOf = (id: string, query: ReplayQuery = defaultReplayQuery) => {
  const screen = openReplay(id, watchViewer(true), query);
  if (screen.kind !== 'watch') throw new Error(`not watchable: ${screen.kind}`);
  return screen.view;
};

describe('the replay player', () => {
  test('the default position', () => {
    const { player } = viewOf('semifinal-rehearsal');
    assert({
      given: 'the default position of 11:30',
      should: 'sit on turn 5 of 12 in Speech [3], spoken by Aff',
      actual: [
        player.turnNumber,
        player.turnCount,
        player.positionLabel,
        player.totalLabel,
        player.phaseName,
        player.speaker,
        player.seat,
        player.tickHref,
        player.tickMs,
      ],
      expected: [
        5,
        12,
        '11:30',
        '30:00',
        'Speech [3]',
        '@debater-g',
        'Aff',
        '/recordings/semifinal-rehearsal?t=691',
        1000,
      ],
    });
  });

  test('navigation', () => {
    const { nav } = viewOf('semifinal-rehearsal').player;
    assert({
      given: 'a position a little past the start of turn 5',
      should: 'restart the turn or phase, then step to the next',
      actual: [nav.prevTurn, nav.prevPhase, nav.nextTurn, nav.nextPhase],
      expected: [
        '/recordings/semifinal-rehearsal?t=600',
        '/recordings/semifinal-rehearsal?t=600',
        '/recordings/semifinal-rehearsal?t=750',
        '/recordings/semifinal-rehearsal?t=900',
      ],
    });
  });

  test('just after a turn starts, previous goes to the turn before', () => {
    const { nav } = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      t: 601,
    }).player;
    assert({
      given: 'a position one second into a turn and phase',
      should: 'step back into the previous turn and phase',
      actual: [nav.prevTurn, nav.prevPhase],
      expected: [
        '/recordings/semifinal-rehearsal?t=450',
        '/recordings/semifinal-rehearsal?t=300',
      ],
    });
  });

  test('the ends of the timetable', () => {
    const end = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      t: 99999,
    });
    const start = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      t: 0,
    });
    assert({
      given: 'a position past the end and one at the start',
      should: 'clamp, stop ticking at the end and start on turn 1',
      actual: [
        end.player.positionLabel,
        end.player.tickHref,
        end.player.nav.nextTurn,
        start.player.turnNumber,
      ],
      expected: ['30:00', null, '/recordings/semifinal-rehearsal?t=1800', 1],
    });
  });

  test('speed changes the tick interval', () => {
    const fast = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      speed: '2',
    });
    assert({
      given: '2x speed',
      should: 'tick every 500 ms',
      actual: fast.player.tickMs,
      expected: 500,
    });
  });
});

describe('the replay timeline and transcript', () => {
  test('phases jump and mark progress', () => {
    const { timeline } = viewOf('semifinal-rehearsal');
    assert({
      given: 'a position in the third phase',
      should: 'mark two done, one current, and link each phase start',
      actual: [
        timeline.steps.map((step) => step.state).join(' '),
        timeline.steps[3]?.href,
      ],
      expected: [
        'done done current upcoming upcoming upcoming',
        '/recordings/semifinal-rehearsal?t=900',
      ],
    });
  });

  test('search filters the transcript; jump options are phase starts', () => {
    const all = viewOf('semifinal-rehearsal').transcript;
    const found = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      q: 'vote neg',
    }).transcript;
    const none = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      q: 'zzz',
    }).transcript;
    assert({
      given: 'no search, a matching search and a search with no match',
      should: 'list 12 turns, 1 turn, none; mark the current turn',
      actual: [
        all.rows.length,
        all.rows.filter((row) => row.current).length,
        found.rows.length,
        none.rows.length,
        all.jump.map((option) => option.value).join(','),
        all.jumpValue,
      ],
      expected: [12, 1, 1, 0, '0,300,600,900,1200,1500', 600],
    });
  });
});

describe('the replay result', () => {
  test('a ranked result with rating changes and judges', () => {
    const { result } = viewOf('semifinal-rehearsal');
    assert({
      given: 'a ranked debate Neg won 2 to 1',
      should: 'show the headline, both rating lines and three numbered judges',
      actual: result.kind === 'published' && [
        result.headline,
        result.lines.map((line) => `${line.who} ${line.range} ${line.delta}`),
        result.judges.map((judge) => judge.title),
      ],
      expected: [
        'Neg wins, 2 to 1',
        ['@debater-g, Aff 1655 to 1646 -9', '@debater-h, Neg 1641 to 1650 +9'],
        ['Judge 1', 'Judge 2', 'Judge 3'],
      ],
    });
  });

  test('pending ballots', () => {
    const { result } = viewOf('evening-round');
    assert({
      given: 'a recording with 2 of 3 ballots in',
      should: 'show pending with the count',
      actual: result,
      expected: { kind: 'pending', received: 2, of: 3 },
    });
  });

  test('a casual result carries no rating change', () => {
    const { result } = viewOf('open-table');
    assert({
      given: 'a casual debate',
      should: 'publish with no rating lines',
      actual: result.kind === 'published' && [result.lines.length, result.note],
      expected: [
        0,
        'Casual debates are not rated, so nothing changes on the ladder.',
      ],
    });
  });
});

describe('the visibility manager', () => {
  test('only the people seated manage; ranked cannot go private', () => {
    const mine = viewOf('fast-rounds', {
      ...defaultReplayQuery,
      manage: true,
      vis: 'public',
    }).share;
    const theirs = viewOf('semifinal-rehearsal', {
      ...defaultReplayQuery,
      manage: true,
    }).share;
    assert({
      given:
        "my unlisted ranked recording and someone else's public one, manager open",
      should:
        'open it for mine with a draft, lock Private, and never for theirs',
      actual: [
        mine.canManage,
        mine.manageOpen,
        mine.options.map(
          (option) => `${option.value}:${option.checked}:${option.locked}`,
        ),
        mine.unchanged,
        theirs.canManage,
        theirs.manageOpen,
      ],
      expected: [
        true,
        true,
        ['public:true:false', 'unlisted:false:false', 'private:false:true'],
        false,
        false,
        false,
      ],
    });
  });

  test('the draft defaults to the current visibility', () => {
    const share = viewOf('practice-with-a-friend', {
      ...defaultReplayQuery,
      manage: true,
    }).share;
    assert({
      given: 'a private casual recording with no draft',
      should: 'check Private, be unchanged and allow Private',
      actual: [
        share.visibility,
        share.unchanged,
        share.options.find((option) => option.checked)?.value,
        share.options.find((option) => option.value === 'private')?.locked,
      ],
      expected: ['Private', true, 'private', false],
    });
  });
});
