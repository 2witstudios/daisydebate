import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  sanctionListSchema,
  seasonReadCatalogue,
  seasonViewSchema,
} from './season-read';

setupRitewayBun();

const id = (name: string) => name.padEnd(24, '0');
const outcome = (
  schema: Parameters<typeof parseOutcome>[0],
  input: unknown,
) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'ok' : parsed.issues;
};

const tournament = {
  lobbyId: id('autumn'),
  handle: 'autumn-open',
  name: 'Autumn Open',
  when: { precision: 'day', startsAt: '2026-11-14T15:00:00.000Z' },
  completed: false,
  sanction: 'approved',
} as const;
const season = {
  seasonId: id('season'),
  name: '2026 to 27 season',
  organization: { organizationId: id('league'), name: 'Southeast League' },
  counting: 'sanction',
  calendar: [
    tournament,
    {
      ...tournament,
      lobbyId: id('final'),
      when: { precision: 'month', month: '2027-03' },
    },
  ],
  standings: {
    series: { templateId: id('template'), name: 'Varsity' },
    certifiedCount: 1,
    awaitingCertification: [{ lobbyId: id('autumn'), name: 'Autumn Open' }],
    rows: [
      {
        place: 1,
        entrant: 'Jensen',
        school: 'Hartwell',
        points: 18,
        viewer: false,
      },
    ],
  },
} as const;

const sanction = {
  sanctionId: id('sanction'),
  status: 'requested',
  event: { eventId: id('event'), name: 'Varsity debate' },
  lobby: {
    lobbyId: id('ridgeview'),
    name: 'Ridgeview Invitational',
    startsAt: '2026-11-28T15:00:00.000Z',
  },
  host: { organizationId: id('school'), name: 'Ridgeview' },
  season: { seasonId: id('season'), name: '2026 to 27 season' },
  template: { templateId: id('template'), name: 'Varsity debate' },
  follows: true,
  mismatches: [],
} as const;
const list = {
  organizationId: id('league'),
  sanctions: [sanction],
  capabilities: { decide: true },
};

describe('season reads', async () => {
  test('a season', () => {
    assert({
      given:
        'a season, a month that is not one, a counting the vocabulary lacks, an extra field',
      should: 'accept only the first',
      actual: [
        outcome(seasonViewSchema, season),
        outcome(seasonViewSchema, {
          ...season,
          calendar: [
            { ...tournament, when: { precision: 'month', month: '2027-13' } },
          ],
        }),
        outcome(seasonViewSchema, { ...season, counting: 'all' }),
        outcome(seasonViewSchema, { ...season, stored: true }),
      ],
      expected: ['ok', ['calendar.0.when.month'], ['counting'], ['(root)']],
    });
  });

  test('sanctions', () => {
    assert({
      given:
        'a request that follows the template, one that differs on a key, a follower said to differ',
      should: 'accept the first two and refuse the third',
      actual: [
        outcome(sanctionListSchema, list),
        outcome(sanctionListSchema, {
          ...list,
          sanctions: [
            {
              ...sanction,
              follows: false,
              mismatches: ['standings.tiebreaks'],
            },
          ],
        }),
        outcome(sanctionListSchema, {
          ...list,
          sanctions: [{ ...sanction, mismatches: ['standings.tiebreaks'] }],
        }),
      ],
      expected: ['ok', 'ok', ['sanctions.0.mismatches']],
    });
    assert({
      given: 'the catalogue',
      should:
        'gate the season on standings.read and sanctions on sanction.read',
      actual: seasonReadCatalogue,
      expected: {
        SeasonView: { gate: ['standings.read'] },
        SanctionList: { gate: ['sanction.read'] },
      },
    });
  });
});
