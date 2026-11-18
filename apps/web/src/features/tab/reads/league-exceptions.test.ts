import { assert, setupRitewayBun, test } from 'riteway/bun';
import { leagueSeasonExceptions } from './league-exceptions';
setupRitewayBun();
test('season exceptions identify people and events without engine ids', () => {
  const rows = leagueSeasonExceptions(
    [
      {
        competitor: 'raw-person',
        event: 'raw-event',
        term: 'preliminary_win',
        reason: 'no_winner_in_format',
      },
      {
        competitor: 'raw-person',
        event: 'raw-event',
        term: 'elimination_round',
        reason: 'competitor_twice_in_event',
      },
    ],
    {
      people: [{ actorId: 'raw-person', name: 'Debater A' }],
      events: [
        {
          competition: {
            configuration: { event: { id: 'raw-event', name: 'Varsity' } },
          },
        },
      ],
    } as never,
  );
  assert({
    given: 'unsupported winner terms and a competitor appearing twice',
    should:
      'explain each missing points term using the actual entrant and event names',
    actual: rows.map((row) => row.message),
    expected: [
      'Debater A · Varsity: Preliminary win points were not counted because this format has no preliminary winner.',
      'Debater A · Varsity: Elimination round points were not counted because the competitor appears in more than one entry.',
    ],
  });
  assert({
    given: 'an unknown engine identity',
    should: 'never expose raw ids in a user-facing exception',
    actual: JSON.stringify(
      leagueSeasonExceptions(
        [
          {
            competitor: 'raw-hidden-person',
            event: 'raw-hidden-event',
            term: 'preliminary_win',
            reason: 'no_winner_in_format',
          },
        ],
        { people: [], events: [] },
      ),
    ).includes('raw-hidden'),
    expected: false,
  });
});
