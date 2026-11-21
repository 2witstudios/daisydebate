import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { hostRoutes } from '../../features/tab/routes';
import { readDrawBoard } from '../../features/tab/test-support/sample/read-draw';
import {
  readHostEntries,
  readHostJudges,
} from '../../features/tab/test-support/sample/read-entries';
import { readEventResults } from '../../features/tab/test-support/sample/read-results';
import { readSetup } from '../../features/tab/test-support/sample/read-setup';
import { readStandings } from '../../features/tab/test-support/sample/read-standings';
import { readRunningRound } from '../../features/tab/test-support/sample/read-tab-round';
import { readTimelineRail } from '../../features/tab/test-support/sample/read-tournament';
import type { SampleScene } from '../../features/tab/test-support/sample/scene';
import { sampleTabRoundView } from '../../features/tab/test-support/sample/tab-round';
import { withDivisionBreak } from '../../features/tab/standings';
import { WithAppRouter } from '../test-support/app-router';
import { DrawBoard } from './draw-board/draw-board';
import { HostEntries } from './host-entries/host-entries';
import { HostJudges } from './host-entries/host-judges';
import { Results } from './results/results';
import { RunningRound } from './running-round/running-round';
import { HostStandings } from './standings/host-standings';

setupRitewayBun();

const slug = 'autumn-open';
const event = 'varsity-debate';
const scene = (
  moment: SampleScene['moment'] = 'prelims',
  scale: SampleScene['scale'] = 'large',
): SampleScene => ({ viewer: 'host', moment, scale });
const html = (element: ReactElement) =>
  renderToStaticMarkup(<WithAppRouter>{element}</WithAppRouter>);
const railOf = (at: SampleScene) => readTimelineRail(slug, at)!;
const hrefs = {
  entriesHref: hostRoutes.entries(slug),
  judgesHref: hostRoutes.judges(slug),
};
const runningRound = (at: SampleScene) =>
  html(
    <RunningRound
      rail={railOf(at)}
      current="round-3"
      round={readRunningRound(slug, event, '3', at)!}
    />,
  );
const hostEntries = (at: SampleScene) =>
  html(
    <HostEntries
      rail={railOf(at)}
      entries={readHostEntries(slug, at)!}
      {...hrefs}
    />,
  );

describe('Tab screens at scale', () => {
  test('the running round merges needs, caps groups and offers search', () => {
    const page = runningRound(scene());
    assert({
      given: '100 rooms including six overdue ballots',
      should:
        'merge overdue ballots and collapse long groups with a working disclosure',
      actual: [
        page.includes('6 ballots are overdue'),
        page.includes('Find a room, entry or judge'),
        page.includes('Show all 40'),
        page.includes('<details'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('the draw keeps findings first, collapses record groups and pins why', () => {
    const at = scene();
    const page = html(
      <DrawBoard
        rail={railOf(at)}
        current="round-4"
        draw={readDrawBoard(slug, event, '4', 'doyle-sato', at)!}
      />,
    );
    assert({
      given: 'the large draft draw',
      should: 'offer search, look first and a sticky explanation',
      actual: [
        page.includes('Look first'),
        page.includes('Find an entry, school or judge'),
        page.includes('sticky'),
        page.includes('<details'),
      ],
      expected: [true, true, true, true],
    });
  });
  test('entries and judges remain short and searchable', () => {
    const at = scene();
    const entries = hostEntries(at);
    const judges = html(
      <HostJudges
        rail={railOf(at)}
        judges={readHostJudges(slug, at)!}
        {...hrefs}
      />,
    );
    assert({
      given: '60 schools and 150 judges',
      should: 'show priorities and searchable collapsed lists',
      actual: [
        entries.includes('Find an entry, school or adult'),
        entries.includes('Needs you'),
        entries.includes('Show all 60'),
        judges.includes('Find a judge or school'),
        judges.includes('<details'),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('standings render each break line and results start at the live round', () => {
    const atBreak = scene('break');
    const atElims = scene('elims');
    const standings = html(
      <HostStandings
        rail={railOf(atBreak)}
        event={readSetup(slug, atBreak)!.event}
        table={readStandings(slug, null, atBreak)!}
      />,
    );
    const results = html(
      <Results
        screen={{
          rail: railOf(atElims),
          event: readSetup(slug, atElims)!.event,
          results: readEventResults(slug, atElims)!,
        }}
      />,
    );
    assert({
      given: '200 entries and a bracket of 64',
      should: 'separate main and novice breaks and disclose earlier rounds',
      actual: [
        standings.includes('Main break'),
        standings.includes('Novice break'),
        standings.includes('Show 58'),
        results.includes('Show earlier rounds'),
        results.includes('<details'),
      ],
      expected: [true, true, true, true, true],
    });
  });
  test('standalone actions on a host screen are buttons', () => {
    assert({
      given: 'the host entries actions',
      should: 'render no old underlined action links',
      actual: hostEntries(scene()).includes('font-strong text-ink underline'),
      expected: false,
    });
  });
  test('urgent, section and finished fixtures keep all their searchable names', () => {
    const scenarios = [
      [event, 'Room 80', 'large'],
      ['impromptu', 'Room 26', 'normal'],
    ] as const;
    assert({
      given: 'an overdue large room and a section needing confirmation',
      should:
        'retain room, judge and entrant facets independently of display copy',
      actual: scenarios.map(([eventSlug, room, scale]) => {
        const at = scene('prelims', scale);
        const source = sampleTabRoundView(slug, eventSlug, '3', at)?.read;
        const fixture = source?.open.find((f) => f.room?.name === room);
        const page = readRunningRound(slug, eventSlug, '3', at);
        const rows = page?.groups.flatMap((group) => group.rooms) ?? [];
        return (
          fixture !== undefined &&
          rows.some(
            (row) =>
              row.words?.includes(room) &&
              fixture.entries.every((entry) =>
                row.words?.includes(entry.name),
              ) &&
              fixture.judges.every((judge) => row.words?.includes(judge.name)),
          )
        );
      }),
      expected: [true, true],
    });
  });
  test('normal finished room totals and paging survive scale composition', () => {
    const page = runningRound(scene('prelims', 'normal'));
    assert({
      given: '20 finished rooms with only three read on the normal page',
      should:
        'show the total and preserve the action to read the other seventeen',
      actual: [page.includes('Finished · 20'), page.includes('Show 17 more')],
      expected: [true, true],
    });
  });
  test('redacted display names never determine who already made another break', () => {
    const table = readStandings(slug, null, scene('break'))!;
    const division = table.divisions[0]!;
    const redact = (row: (typeof table.rows)[number]) => ({
      ...row,
      entry: 'A.',
    });
    const composed = withDivisionBreak(
      { ...table, rows: table.rows.map(redact) },
      { ...division, rows: division.rows.map(redact) },
    );
    assert({
      given:
        'different entrants whose public display names are the same initials',
      should: 'exclude higher-break entrants by stable identity only',
      actual: composed.divisions[0]?.rows.length,
      expected: division.rows.length,
    });
  });
});
