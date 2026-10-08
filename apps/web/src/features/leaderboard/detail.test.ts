import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { buildDetail } from './detail';
import { NOW } from './ladder.test-support';
import { readDebater, readLadder } from './read-leaderboard';

setupRitewayBun();

const season = (id: number) => {
  const found = readLadder(id, NOW, null).data.season;
  return found;
};
const detail = (
  username: string,
  seasonId: number,
  viewer: { username: string; blinded: readonly string[] } | null = null,
  query: { view: 'chart' | 'table'; step: number | null } = {
    view: 'chart',
    step: null,
  },
) =>
  buildDetail(
    username,
    season(seasonId),
    readDebater(username, seasonId, NOW, viewer?.username ?? null),
    query,
    viewer,
  );

describe('buildDetail', () => {
  test('an established debater', () => {
    const view = detail('debater-b', 4);
    assert({
      given: 'the top debater in the live season',
      should:
        'give stats with no bloom band, chart and the three seasons played',
      actual: view.kind === 'player' && {
        stats: [
          view.rating,
          view.range,
          view.rank,
          'band' in view,
          view.established,
          view.statusNote,
        ],
        readout:
          view.readouts.at(-1)?.heading ===
          `Debate ${view.lastStep} of ${view.lastStep}`,
        recent: view.recent.length,
        results: view.results.length === view.lastStep,
        establishedMark: view.chart.establishedX !== null,
        seasons: view.seasons.map((row) => [row.label, row.rank, row.current]),
        profileHref: view.profileHref,
      },
      expected: {
        stats: [
          1716,
          '±' + (view.kind === 'player' ? view.range.slice(1) : ''),
          '#1',
          false,
          true,
          'Established',
        ],
        readout: true,
        recent: 5,
        results: true,
        establishedMark: true,
        seasons: [
          ['Season 4', '#1', true],
          ['Season 3', '#1', false],
          ['Season 2', '#1', false],
        ],
        profileHref: '/profile/debater-b',
      },
    });
  });

  test('the viewer, provisional', () => {
    const viewer = { username: 'sam', blinded: [] };
    const view = detail('sam', 4, viewer, { view: 'table', step: 4 });
    assert({
      given:
        'the signed-in viewer with seven ranked debates, on the table view at step 4',
      should:
        'say they are provisional and unranked with no established mark, band or region',
      actual: view.kind === 'player' && [
        view.me,
        view.rank,
        'band' in view,
        view.statusNote,
        view.chart.establishedX,
        view.view,
        view.step,
        view.readouts[view.step]?.heading,
        view.subtitle,
      ],
      expected: [
        true,
        'Unranked',
        false,
        '7 of 10 ranked debates',
        null,
        'table',
        4,
        'Debate 4 of 7',
        'Season 4',
      ],
    });
  });

  test('step is clamped', () => {
    const view = detail(
      'sam',
      4,
      { username: 'sam', blinded: [] },
      {
        view: 'chart',
        step: 500,
      },
    );
    assert({
      given: 'a step beyond the last debate',
      should: 'clamp to the last debate',
      actual: view.kind === 'player' && view.step,
      expected: 7,
    });
  });

  test('a debater with no ranked debates that season', () => {
    const viewer = { username: 'sam', blinded: [] };
    assert({
      given: 'the viewer in a season before their first debate, and a stranger',
      should: 'say no ranked debates, in first or third person',
      actual: [detail('sam', 2, viewer), detail('nobody-here', 4)].map(
        (view) => view.kind === 'none' && view.text,
      ),
      expected: [
        'You have no ranked debates in Season 2.',
        '@nobody-here has no ranked debates in Season 4.',
      ],
    });
  });

  test('a debater the viewer is judging', () => {
    const view = detail('debater-b', 4, {
      username: 'sam',
      blinded: ['debater-b'],
    });
    assert({
      given: 'a judge assigned to this debater',
      should: 'reveal nothing about their rating',
      actual: [view.kind, JSON.stringify(view).includes('1716')],
      expected: ['hidden', false],
    });
  });
});
