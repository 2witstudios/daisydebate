import { sampleTournamentReads } from '../../features/tab/sample/tournament';
import { withDivisionBreak } from '../../features/tab/standings';
import { readStandings } from '../../features/tab/sample/read-standings';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { readRunningRound } from '../../features/tab/sample/read-tab-round';
import { sampleTabRoundView } from '../../features/tab/sample/tab-round';
import { readTournamentPage } from '../../features/tab/sample/read-tournament';
import { sampleAnswer } from './sample-screens.test-support';
import { renderToStaticMarkup } from 'react-dom/server';
import { WithAppRouter } from '../test-support/app-router';
import { SchoolPostings } from './tournament-page/school-postings';
setupRitewayBun();
const large = { viewer: 'host', moment: 'prelims', scale: 'large' } as const;
describe('interface-3 review regressions', () => {
  test('calendar queries terminate at both year boundaries', async () => {
    const results = [];
    for (const month of ['0000-01', '9999-12']) {
      const code = `import {readTournamentsIndex} from ${JSON.stringify(Bun.resolveSync('../../features/tab/sample/read-tournaments-index.ts', import.meta.dir))}; const page=readTournamentsIndex(${JSON.stringify(large)},{view:'calendar',month:${JSON.stringify(month)}}); console.log(page.calendar?.weeks.length);`;
      const child = Bun.spawn(['bun', '-e', code], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      // A hanging calendar never exits: the test runner's timeout fails it.
      results.push(await child.exited);
    }
    assert({
      given: 'calendar months at both four-digit year boundaries',
      should: 'return a bounded calendar instead of hanging the route',
      actual: results,
      expected: [0, 0],
    });
  });
  test('urgent, section and finished fixtures keep all their searchable names', () => {
    const scenarios = [
      ['varsity-debate', 'Room 80', 'large'],
      ['impromptu', 'Room 26', 'normal'],
    ] as const;
    assert({
      given: 'an overdue large room and a section needing confirmation',
      should:
        'retain room, judge and entrant facets independently of display copy',
      actual: scenarios.map(([event, room, scale]) => {
        const scene = { ...large, scale };
        const source = sampleTabRoundView(
          'autumn-open',
          event,
          '3',
          scene,
        )?.read;
        const fixture = source?.open.find((f) => f.room?.name === room);
        const page = readRunningRound('autumn-open', event, '3', scene);
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
    const answer = sampleAnswer(
      '/host/tournaments/autumn-open/events/varsity-debate/rounds/3',
      { ...large, scale: 'normal' },
    );
    const html =
      answer.kind === 'screen'
        ? renderToStaticMarkup(<WithAppRouter>{answer.element}</WithAppRouter>)
        : '';
    assert({
      given: '20 finished rooms with only three read on the normal page',
      should:
        'show the total and preserve the action to read the other seventeen',
      actual: [html.includes('Finished · 20'), html.includes('Show 17 more')],
      expected: [true, true],
    });
  });
  test('participants receive the separate novice ranking without main-break duplicates', () => {
    const page = readTournamentPage(
      'autumn-open',
      { kind: 'standings', event: null },
      { viewer: 'competitor', moment: 'break', scale: 'large' },
    );
    const table =
      page?.kind === 'rounds' && page.panel.kind === 'standings'
        ? page.panel.table
        : null;
    const main = new Set(table?.rows.slice(0, 64).map((row) => row.entry));
    assert({
      given: 'a participant reading the large break standings',
      should:
        'show the novice ranking and exclude those already in the main break',
      actual: [
        table?.divisions.length,
        table?.divisions[0]?.rows.some((row) => main.has(row.entry)),
      ],
      expected: [1, false],
    });
  });
  test('schoolless postings remain available beside school groups', () => {
    const html = renderToStaticMarkup(
      <WithAppRouter>
        <SchoolPostings
          panel={{
            kind: 'posting',
            heading: 'Round 4',
            school: null,
            more: 0,
            rows: [
              {
                title: 'Independent A v Independent B',
                detail: 'Room 44',
                schools: [],
                action: null,
              },
            ],
          }}
        />
      </WithAppRouter>,
    );
    assert({
      given: 'a posted fixture with no school affiliation',
      should: 'retain it in a searchable unaffiliated group',
      actual: [
        html.includes('Not from a school'),
        html.includes('Independent A v Independent B'),
      ],
      expected: [true, true],
    });
  });
  test('public large postings never offer the participants video', () => {
    const reads = sampleTournamentReads(
      'autumn-open',
      { kind: 'round', event: 'varsity-debate', round: '4' },
      { viewer: 'visitor', moment: 'prelims', scale: 'large' },
    );
    assert({
      given: 'the public large posting with entrants shown by initials',
      should:
        'keep video closed to the public while retaining public school facets',
      actual: [
        reads?.posting?.fixtures.every((fixture) => !fixture.video),
        reads?.posting?.fixtures.every((fixture) =>
          fixture.entries.every(
            (entry) => entry.shown.kind === 'initials' && entry.school !== null,
          ),
        ),
      ],
      expected: [true, true],
    });
  });
  test('redacted display names never determine who already made another break', () => {
    const table = readStandings('autumn-open', null, {
      ...large,
      moment: 'break',
    })!;
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
