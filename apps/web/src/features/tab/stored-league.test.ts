import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { LeagueLobby } from '../../ui/tab/league-lobby/league-lobby';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { storedLeagueLobbyOf } from './stored-league';
setupRitewayBun();
test('stored league season projection', () => {
  const read = {
    view: {
      seasonId: 'season',
      name: 'Spring',
      organization: { organizationId: 'league', name: 'Actual League' },
      lobby: { lobbyId: 'lobby', name: 'League lobby', ageRule: 'adults' },
      counting: 'sanction',
      calendar: [],
      standings: {
        series: { templateId: 'template', name: 'Varsity' },
        certifiedCount: 1,
        awaitingCertification: [],
        rows: [
          {
            place: 1,
            entrant: 'Actual debater',
            school: 'Actual school',
            points: 8,
            viewer: true,
          },
        ],
      },
    },
    series: [{ id: 'template', name: 'Varsity' }],
    exceptions: [
      {
        entrant: 'Actual debater',
        event: 'Varsity',
        message:
          'Actual debater · Varsity: preliminary win points were not counted.',
      },
    ],
    formula: {
      preliminaryWin: { points: 2, cap: null },
      eliminationRound: { points: 3 },
      bestEvents: 2,
      topPerSchool: null,
    },
  };
  const lobby = storedLeagueLobbyOf(
    'actual',
    read as never,
    { tab: 'season', event: null },
    null,
  );
  const html = renderToStaticMarkup(createElement(LeagueLobby, { lobby }));
  assert({
    given: 'a stored season with an explicit omitted points term',
    should: 'render its named exception beside the standings',
    actual: html.includes(
      'Actual debater · Varsity: preliminary win points were not counted.',
    ),
    expected: true,
  });
  assert({
    given: 'stored certified standings and the actual configured formula',
    should:
      'render actual people, template picker and point rules without sample records or actions',
    actual: [
      lobby.name,
      lobby.tabs.map((tab) => tab.id),
      lobby.panel.kind === 'season' ? lobby.panel.rows : [],
      lobby.panel.kind === 'season' ? lobby.panel.points : [],
    ],
    expected: [
      'Actual League',
      ['rooms', 'ladder', 'season', 'tournaments'],
      [
        {
          place: 1,
          name: 'Actual debater',
          school: 'Actual school',
          points: 8,
          you: true,
        },
      ],
      [
        { label: 'Preliminary win', points: 2 },
        { label: 'Elimination round', points: 3 },
      ],
    ],
  });
});
