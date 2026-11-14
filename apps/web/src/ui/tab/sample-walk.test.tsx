import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  sampleMoments,
  sampleViewers,
  type SampleScene,
} from '../../features/tab/sample/scene';
import type { StandingsTable as Table } from '../../features/tab/standings';
import { readWalk } from '../../features/tab/walk';
import { WithAppRouter } from '../test-support/app-router';
import { routeExists } from '../test-support/route-exists';
import { sampleAnswer } from './sample-screens.test-support';
import { StandingsTable } from './standings/standings-table';

setupRitewayBun();

const appDirectory = join(import.meta.dir, '../../app');
const scenes: readonly SampleScene[] = sampleViewers.flatMap((viewer) =>
  sampleMoments.map((moment) => ({ viewer, moment })),
);
const sceneName = (scene: SampleScene) => `${scene.viewer}.${scene.moment}`;

/** Pages of the product a Tab screen may link to: not Tab's own to answer. */
const outside = new Set(['/', '/lobby', '/sign-in']);

const hrefsIn = (html: string): readonly string[] =>
  [...html.matchAll(/href="([^"]*)"/g)]
    .map((match) => (match[1] ?? '').replaceAll('&amp;', '&'))
    // A sample action answers on the page it is on.
    .filter((href) => href.startsWith('/') && !href.includes('did='));

type Crawl = {
  readonly dead: readonly string[];
  readonly html: ReadonlyMap<string, string>;
};

/** Every screen a viewer reaches from the walk page by following links. */
function crawl(scene: SampleScene): Crawl {
  const html = new Map<string, string>();
  const dead: string[] = [];
  const queue = [
    '/tournaments/walk',
    ...readWalk(scene).steps.map((s) => s.href),
  ];
  const seen = new Set(queue);
  for (let href = queue.shift(); href !== undefined; href = queue.shift()) {
    const path = href.split('?')[0] ?? '';
    if (outside.has(path)) continue;
    const answer = sampleAnswer(href, scene);
    if (answer.kind === 'missing' || !routeExists(appDirectory, path)) {
      dead.push(`${sceneName(scene)}: ${href}`);
      continue;
    }
    const next =
      answer.kind === 'moved'
        ? [answer.to]
        : hrefsIn(
            html
              .set(
                href,
                renderToStaticMarkup(
                  <WithAppRouter>{answer.element}</WithAppRouter>,
                ),
              )
              .get(href) ?? '',
          );
    for (const found of next)
      if (!seen.has(found)) {
        seen.add(found);
        queue.push(found);
      }
  }
  return { dead, html };
}

const crawls = new Map(scenes.map((scene) => [sceneName(scene), crawl(scene)]));
const everything = [...crawls.values()]
  .flatMap((walk) => [...walk.html.values()])
  .join('\n');

/** One line only its board carries, for each board on the canvas. */
const canvas: Readonly<Record<string, string>> = {
  'Host: tab round running': 'has not opened the ballot',
  'Host: draft draw': 'Why this fixture',
  'Host: standings and break': 'Placed here because',
  'Host: bracket, certify, release': 'Before you certify',
  'Host: tournament setup': 'A host picks a preset.',
  'Host: entries and judges': 'Invite a school or parent',
  'Host: people and roles': 'Roles, highest first',
  'Host: home': 'Your tournaments',
  'Host: league': 'Asking to count for the season',
  'Host: ballot settings': 'What a judge sees',
  'Host: resolutions': 'By round',
  'Host: judges': 'Never judges',
  'Tournament: during': 'Sato v You',
  'Tournament: before': '9 of 16 places taken',
  'Event Room: waiting': 'Set by Autumn Open',
  'Event Room: speech section': 'Speaking order',
  'Ballot: host-configured': 'Your ballot',
  'Parent or coach': 'Ballots you can read',
  "Minor's account: restrictions": 'Lobbies Ada can see and join',
  'League lobby': 'pool:',
  'Postings, signed out': 'Taking part? Sign in to see your room',
  'Event Room: four teams': 'Opening Opposition',
  'Open Room: main Daisy': 'Run of show',
  'Parent: allow a tournament': 'If you allow it',
  'Host: one time slot, several events': 'Events in this slot',
  'Host: events and schedule': 'Judges are one pool.',
  'Competitor: entered in three events': 'Later today',
  'Coach: entering a school': 'Fix Amari',
  'Tournaments: index': 'Open to enter',
  'League: ladder': 'Top of the ladder',
  'League: season': 'How points count',
  'League: tournaments': 'All five count toward',
  'League: create a room': 'People I invite',
  'Tournament: after': 'Recordings you can watch',
  'Parent: your family': 'account active',
  'Host: a speech event, round running': 'all six have spoken',
};

describe('the sample tournament', () => {
  test('every link on every screen leads to a screen', () => {
    assert({
      given:
        'each sample viewer at each moment, following every link from the walk page',
      should: 'reach only routes that exist and reads that answer',
      actual: [...crawls.values()].flatMap((walk) => walk.dead),
      expected: [],
    });
  });

  test('every board on the canvas is reached', () => {
    assert({
      given: 'every screen reached by any viewer at any moment',
      should: 'include each board',
      actual: Object.entries(canvas)
        .filter(([, line]) => !everything.includes(line))
        .map(([board]) => board),
      expected: [],
    });
  });

  test('the host area is for a member with a grant', () => {
    assert({
      given: 'a host address opened with and without a grant',
      should:
        'show the host shell to the host and move anyone else to the participant page',
      actual: [
        sampleAnswer('/host', { viewer: 'host', moment: 'prelims' }).kind,
        sampleAnswer('/host/tournaments/autumn-open/setup', {
          viewer: 'coach',
          moment: 'prelims',
        }),
        sampleAnswer('/host/tournaments/autumn-open/standings', {
          viewer: 'competitor',
          moment: 'prelims',
        }),
      ],
      expected: [
        'screen',
        { kind: 'moved', to: '/tournaments/autumn-open' },
        { kind: 'moved', to: '/tournaments/autumn-open/standings' },
      ],
    });
  });

  test('a setting is shown once, with its source and its lock', () => {
    const html = crawls
      .get('host.before')
      ?.html.get('/host/tournaments/autumn-open/setup');
    assert({
      given: 'tournament setup on the resolved-settings shape',
      should: 'show the tiebreaks once, set by the league and locked',
      actual: [
        html?.split('<strong class="font-strong">Tiebreaks</strong>').length,
        html?.includes('set by Southeast League'),
        html?.includes('Locked'),
      ],
      expected: [2, true, true],
    });
  });

  test('a template pins the whole ballot', () => {
    const host = crawls.get('host.prelims')?.html;
    const setup = host?.get('/host/tournaments/autumn-open/setup') ?? '';
    const ballot =
      host?.get('/host/tournaments/autumn-open/events/varsity-debate/ballot') ??
      '';
    assert({
      given: "an event that follows a league's template",
      should:
        'hold format, ballot and recording locked on setup, link the ballot to its page, and leave only text screening to choose there',
      actual: [
        ['Format', 'Ballot', 'Recording'].map((label) =>
          new RegExp(
            `<strong class="font-strong">${label}</strong>(?:(?!</li>).)*Locked`,
          ).test(setup),
        ),
        setup.includes('aria-label="View: Ballot"'),
        [...ballot.matchAll(/<select[^>]*name="([^"]*)"/g)].map(
          (match) => match[1],
        ),
      ],
      expected: [[true, true, true], true, ['screening']],
    });
  });

  test('a guardian comes back to their family', () => {
    const parent = crawls.get('parent.prelims')?.html;
    assert({
      given: "a minor's account and a tournament waiting to be allowed",
      should: 'lead back to the family page, which leads to both',
      actual: [
        hrefsIn(parent?.get('/family/ada') ?? '').includes('/family'),
        hrefsIn(
          parent?.get('/family/ada/allow/capital-city-classic') ?? '',
        ).includes('/family'),
        hrefsIn(parent?.get('/family') ?? '').filter((href) =>
          href.startsWith('/family/'),
        ),
      ],
      expected: [
        true,
        true,
        ['/family/ada/allow/capital-city-classic', '/family/ada'],
      ],
    });
  });

  test("the event picker's other events have a screen", () => {
    const host = crawls.get('host.prelims')?.html;
    const impromptu = '/host/tournaments/autumn-open/events/impromptu/rounds/3';
    assert({
      given: 'a host on a Varsity debate page while rounds run',
      should: "reach Impromptu's running round from the picker, and back",
      actual: [
        hrefsIn(
          host?.get('/host/tournaments/autumn-open/setup') ?? '',
        ).includes(impromptu),
        hrefsIn(host?.get(impromptu) ?? '').includes(
          '/host/tournaments/autumn-open/events/varsity-debate/rounds/3',
        ),
      ],
      expected: [true, true],
    });
  });

  test('a finished tournament, for someone who took part', () => {
    const page = (viewer: SampleScene['viewer']) =>
      crawls
        .get(`${viewer}.finished`)
        ?.html.get('/tournaments/autumn-open')
        ?.includes('Your result');
    assert({
      given: 'Autumn Open certified',
      should: 'show a competitor their result and nobody else one',
      actual: [page('competitor'), page('judge'), page('visitor')],
      expected: [true, false, false],
    });
  });

  test('a screen reads only the shape of its aggregate', () => {
    const table: Table = {
      title: 'Standings',
      lede: '',
      tiebreaks: {
        keys: ['standings.tiebreaks'],
        label: 'Tiebreaks',
        value: 'Wins',
        source: { scope: 'daisy', name: 'Daisy' },
        control: { kind: 'open', hold: 'default', edit: null },
        attention: null,
      },
      tiebreakOrder: ['wins'],
      rows: [
        {
          seed: 1,
          entry: 'Another source',
          school: 'Elsewhere',
          wins: 2,
          points: 55,
          opponentWins: 1,
          rating: null,
          reason: 'Only entry',
          decisive: false,
        },
      ],
      breakAfter: null,
      remaining: 0,
      announce: null,
      correction: null,
    };
    const html = renderToStaticMarkup(<StandingsTable table={table} />);
    assert({
      given: 'standings from a source other than the sample, in the same shape',
      should: 'render them unchanged',
      actual: [html.includes('Another source'), html.includes('Unrated')],
      expected: [true, true],
    });
  });
});
