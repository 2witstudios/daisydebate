import { choice, sampleAction } from '../action';
import type { EventForm, EventsSchedule, ScheduledEvent } from '../events';
import { hostRoutes } from '../routes';
import { AUTUMN, LEAGUE_NAME, VARSITY, WINTER } from './moment';
import type { SampleScene } from './scene';

const event = (
  tournament: string,
  slug: string,
  name: string,
  summary: string,
): ScheduledEvent => ({
  slug,
  name,
  summary,
  href: hostRoutes.events(tournament, slug),
});

const parli: EventForm = {
  slug: 'parli',
  name: 'Parli',
  format: { value: 'League parli', source: `set by ${LEAGUE_NAME}` },
  divisions: choice(
    'Divisions',
    [
      'One pool, novices break separately',
      'Everyone together',
      'Separate events, each with its own draw',
    ],
    'Everyone is drawn together in prelims. Novices also get their own break and awards.',
  ),
  novice: {
    value: 'First or second season',
    source: "the league's definition",
  },
  prelimRounds: choice('Prelim rounds', ['3', '4', '5']),
  openBreak: choice('Open break', ['Top 8', 'Top 4', 'Top 16']),
  noviceBreak: choice('Novice break', ['Top 4', 'Top 2', 'Top 8']),
  doubleQualifier: choice('A novice who makes both breaks', [
    'Goes to the open break; the next novice moves up',
    'Debates in both',
    'Chooses',
  ]),
  runsWith: choice('Runs with', [
    'Debate',
    'Speech A',
    'Speech B',
    'A new group',
  ]),
  settings: sampleAction('Parli settings'),
  remove: sampleAction('Remove event'),
};

const varsity: EventForm = {
  slug: VARSITY,
  name: 'Varsity debate',
  format: { value: 'League one-on-one', source: `set by ${LEAGUE_NAME}` },
  divisions: choice('Divisions', [
    'Everyone together',
    'One pool, novices break separately',
    'Separate events, each with its own draw',
  ]),
  novice: {
    value: 'First or second season',
    source: "the league's definition",
  },
  prelimRounds: choice('Prelim rounds', ['4', '3', '5']),
  openBreak: choice('Open break', ['Top 8', 'Top 4', 'Top 16']),
  noviceBreak: choice('Novice break', ['Top 4', 'Top 2', 'Top 8']),
  doubleQualifier: choice('A novice who makes both breaks', [
    'Goes to the open break; the next novice moves up',
    'Debates in both',
    'Chooses',
  ]),
  runsWith: choice('Runs with', ['Debate', 'Speech', 'A new group']),
  settings: sampleAction('Varsity debate settings'),
  remove: sampleAction('Remove event'),
};

const shared = {
  actions: [sampleAction('Edit times'), sampleAction('Add event', true)],
  entryLimit: {
    rule: 'one debate event, one Speech A event and one Speech B event',
    source: `Set by ${LEAGUE_NAME}.`,
  },
  judgePool: {
    rule: 'A judge is cleared per event and is never in two rooms in the same slot.',
    action: sampleAction('Who is cleared for what'),
  },
} as const;

export function sampleEventsSchedule(
  slug: string,
  selected: string | null,
  _scene: SampleScene,
): EventsSchedule | null {
  if (slug === WINTER) {
    const one = (eventSlug: string, name: string, summary: string) =>
      event(WINTER, eventSlug, name, summary);
    return {
      ...shared,
      lede: '8 events in three groups. Events in a group run at the same time.',
      groups: [
        {
          name: 'Debate',
          times: '09:00, 12:00, 15:00, breaks 18:00',
          events: [
            one(
              'varsity-ld',
              'Varsity LD',
              'League one-on-one format · anyone · breaks to quarterfinals · counts for the season',
            ),
            one(
              'novice-ld',
              'Novice LD',
              'League one-on-one format · first or second season · breaks to semifinals · counts for the season',
            ),
            one(
              'varsity-pf',
              'Varsity PF',
              'League teams format · anyone · breaks to quarterfinals · counts for the season',
            ),
            one(
              'parli',
              'Parli',
              'League parli format · one pool, novices break separately · counts for the season',
            ),
          ],
        },
        {
          name: 'Speech A',
          times: '10:30, final 16:30',
          events: [
            one(
              'impromptu',
              'Impromptu',
              'Sections of six, ranked · anyone · top six to the final',
            ),
            one(
              'oratory',
              'Oratory',
              'Sections of six, ranked · anyone · top six to the final',
            ),
          ],
        },
        {
          name: 'Speech B',
          times: '13:30, final 16:30',
          events: [
            one(
              'extemp',
              'Extemp',
              'Sections of six, ranked · topic drawn 30 minutes before · top six to the final',
            ),
            one(
              'interp',
              'Interp',
              'Sections of six, ranked · anyone · top six to the final',
            ),
          ],
        },
      ],
      selected: selected === null || selected === 'parli' ? parli : null,
    };
  }
  if (slug === AUTUMN)
    return {
      ...shared,
      lede: '3 events in two groups. Events in a group run at the same time.',
      groups: [
        {
          name: 'Debate',
          times: '10:00, 11:40, 13:20, 15:00, break 16:45',
          events: [
            event(
              AUTUMN,
              VARSITY,
              'Varsity debate',
              'League one-on-one format · anyone · breaks to quarterfinals · counts for the season',
            ),
            event(
              AUTUMN,
              'novice-debate',
              'Novice debate',
              'League one-on-one format · first or second season · breaks to semifinals',
            ),
          ],
        },
        {
          name: 'Speech',
          times: '10:50, 14:10, final 17:10',
          events: [
            event(
              AUTUMN,
              'impromptu',
              'Impromptu',
              'Sections of six, ranked · anyone · top six to the final',
            ),
          ],
        },
      ],
      entryLimit: {
        rule: 'one debate event and one speech event',
        source: `Set by ${LEAGUE_NAME}.`,
      },
      selected: selected === null || selected === VARSITY ? varsity : null,
    };
  return null;
}
