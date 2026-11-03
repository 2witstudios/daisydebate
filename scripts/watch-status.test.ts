import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { NOW_END, NOW_START } from './progress-canvas';
import {
  namedCodes,
  readWatchBoard,
  renderWatchStatus,
  runWatchStatusSync,
  type WatchBoard,
  type WatchPr,
  type WatchStatusDeps,
  type WatchTask,
} from './watch-status';

setupRitewayBun();

const task = (
  code: string,
  status = 'pending',
  label = 'To Do',
  group = 'todo',
): WatchTask => ({
  code,
  pageId: `page-${code}`,
  title: `${code} — Given a thing, should do it`,
  status,
  statusLabel: label,
  group,
});

const block = (
  name: string,
  spec: string,
  tasks: string,
) => `<h3>Score: ${name}</h3>
<table>
<tr><td>Category</td><td>Audience experience</td></tr>
<tr><td>Subtitle</td><td>a subtitle</td></tr>
<tr><td>Features</td><td>10</td></tr>
<tr><td>Stable</td><td>10</td></tr>
<tr><td>Hardened</td><td>30</td></tr>
<tr><td>Scale</td><td>0</td></tr>
<tr><td>Spec</td><td>${spec}</td></tr>
<tr><td>Status</td><td>A note &amp; more.</td></tr>
<tr><td>Tasks</td><td>${tasks}</td></tr>
</table>`;

const source = `${block('Discovery', '100', 'WATCH-1 WATCH-2')}
<!-- standing -->
<div class="cat"><h2>Before production</h2><p class="p">Needs <task>WATCH-2</task>.</p></div>
<!-- changes -->
<div class="cat"><table><tr><td class="name">One part</td><td class="tasks"><task>WATCH-1</task></td></tr><tr><td class="name">Another part</td></tr></table></div>
<!-- reference -->
<table><tr><td class="name">1. Decide</td><td><task>WATCH-2</task></td></tr><!-- unplaced --></table>
<dl><dt><task>DEC-7</task></dt><dd>Named here.</dd></dl>
`;

const board: WatchBoard = {
  tasks: [
    task('WATCH-1', 'in_progress', 'In Progress', 'in_progress'),
    task('WATCH-2', 'completed', 'Done', 'done'),
    task('WATCH-H'),
    task('WATCH-13'),
    task('DEC-7', 'confirmed', 'Confirmed', 'done'),
  ],
  epicLeaves: ['WATCH-1', 'WATCH-2', 'WATCH-H', 'WATCH-13'],
};

const pr: WatchPr = {
  number: 553,
  title: 'feat(watch): a <title>',
  state: 'OPEN',
  isDraft: true,
  mergeable: 'CONFLICTING',
  headRefName: 'pu/watch',
  statusCheckRollup: [
    { status: 'COMPLETED', conclusion: 'SUCCESS' },
    { status: 'COMPLETED', conclusion: 'FAILURE' },
    { status: 'COMPLETED', conclusion: 'SKIPPED' },
    { status: 'IN_PROGRESS', conclusion: '' },
  ],
};

const render = (over: Partial<WatchBoard> = {}, sourceHtml = source) =>
  renderWatchStatus(sourceHtml, { ...board, ...over }, pr);

/** The message `run` throws, or 'no error'. */
const thrown = (run: () => unknown) => {
  try {
    run();
    return 'no error';
  } catch (error) {
    return (error as Error).message;
  }
};

const nowOf = (html: string) =>
  html.slice(html.indexOf(NOW_START), html.indexOf(NOW_END));

describe('renderWatchStatus', () => {
  test('colours and links a task from the board', () => {
    const html = render();
    assert({
      given: 'a task the source names and the board marks In Progress',
      should: 'link it to its page with its status as class and title',
      actual: html.includes(
        '<a class="code st-active" title="In Progress" href="https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/page-WATCH-1">WATCH-1</a>',
      ),
      expected: true,
    });
    assert({
      given: 'a task the board marks Done',
      should: 'carry the done class',
      actual: html.includes('<a class="code st-done" title="Done"'),
      expected: true,
    });
    assert({
      given: 'a rendered canvas',
      should: 'leave no authored task tag behind',
      actual: html.includes('<task>'),
      expected: false,
    });
  });

  test('computes every number from its source', () => {
    const html = render();
    assert({
      given: 'one area whose dimensions average 30',
      should: 'show that overall in the row and the whole',
      actual: html.includes('<small>average of 1 areas</small>'),
      expected: true,
    });
    assert({
      given: 'two rows in the changes section',
      should: 'count them rather than state a number',
      actual: html.includes('2 changes needed outside Watch itself.'),
      expected: true,
    });
    assert({
      given: 'a note with an entity',
      should: 'escape it once',
      actual: html.includes('A note &amp; more.'),
      expected: true,
    });
  });

  test('renders the same page twice from the same input', () => {
    assert({
      given: 'an unchanged board, source and PR',
      should: 'render identically',
      actual: render() === render(),
      expected: true,
    });
  });

  test('a task status change changes only that task', () => {
    assert({
      given: 'WATCH-2 moved back to To Do',
      should: 'drop its done colouring',
      actual: render({
        tasks: board.tasks.map((item) =>
          item.code === 'WATCH-2' ? task('WATCH-2') : item,
        ),
      }).includes(
        'st-done" title="Done" href="https://pagespace.ai/dashboard/lguvh1y1ejhadk96xcftohha/page-WATCH-2',
      ),
      expected: false,
    });
  });

  test('the Now section is the PR and the board, nothing written by hand', () => {
    const now = nowOf(render());
    assert({
      given: 'a draft conflicting PR',
      should: 'state its draft and merge state and branch',
      actual: ['>draft<', '>conflicting<', 'pu/watch', '/pull/553"'].every(
        (part) => now.includes(part),
      ),
      expected: true,
    });
    assert({
      given: 'a PR title with markup',
      should: 'escape it',
      actual: now.includes('a &lt;title&gt;'),
      expected: true,
    });
    assert({
      given: 'four checks in four states',
      should: 'summarise them',
      actual: now.includes('1 passed, 1 failed, 1 pending, 1 skipped'),
      expected: true,
    });
    assert({
      given: 'four epic leaves',
      should: 'count them by status',
      actual: now.includes('4 tasks: 1 Done, 1 In Progress, 2 To Do'),
      expected: true,
    });
    assert({
      given: 'a task in progress',
      should: 'name it in the Now section',
      actual: now.includes('>WATCH-1</a>'),
      expected: true,
    });
  });

  test('a PR with no checks says so', () => {
    assert({
      given: 'no check runs',
      should: 'say none rather than a row of zeroes',
      actual: nowOf(
        renderWatchStatus(source, board, { ...pr, statusCheckRollup: [] }),
      ).includes('no checks'),
      expected: true,
    });
  });

  test('a commit status check counts by its state', () => {
    assert({
      given: 'a status context, which has state and no conclusion',
      should: 'count it from its state',
      actual: nowOf(
        renderWatchStatus(source, board, {
          ...pr,
          statusCheckRollup: [{ state: 'SUCCESS' }, { state: 'PENDING' }],
        }),
      ).includes('1 passed, 0 failed, 1 pending, 0 skipped'),
      expected: true,
    });
  });

  test('owner decisions come from the board', () => {
    assert({
      given: 'no open decision but an open sign-off leaf',
      should: 'say none open and name the sign-off still needed',
      actual: [
        '<h2>Owner decisions needed <span class="tag">none open</span></h2>',
        '>WATCH-H</a>',
      ].every((part) => render().includes(part)),
      expected: true,
    });
    const open = {
      ...task('DEC-7'),
      title: 'DEC-7 — Should it <stay>',
    };
    const html = render({
      tasks: board.tasks.map((item) => (item.code === 'DEC-7' ? open : item)),
    });
    assert({
      given: 'an open decision the source names',
      should: 'count it and show its escaped title',
      actual: [
        '<span class="tag">1 open</span>',
        'DEC-7 — Should it &lt;stay&gt;',
      ].every((part) => html.includes(part)),
      expected: true,
    });
    const elsewhere = {
      ...task('DEC-9'),
      title: 'DEC-9 — WATCH-1: which way?',
    };
    assert({
      given: 'an open decision whose title names an epic task',
      should: 'count it though the source never names it',
      actual: render({ tasks: [...board.tasks, elsewhere] }).includes(
        '>DEC-9</a>',
      ),
      expected: true,
    });
    const unrelated = { ...task('DEC-10'), title: 'DEC-10 — Unrelated' };
    assert({
      given: 'an open decision about something else',
      should: 'leave it off this page',
      actual: render({ tasks: [...board.tasks, unrelated] }).includes('DEC-10'),
      expected: false,
    });
  });

  test('a leaf with no place on the page still shows', () => {
    assert({
      given: 'an epic leaf the source never names',
      should: 'list it under Not yet placed in the order of work',
      actual: /Not yet placed.*>WATCH-13<\/a>/.test(render()),
      expected: true,
    });
    assert({
      given: 'every leaf placed',
      should: 'add no such row',
      actual: render({
        epicLeaves: ['WATCH-1', 'WATCH-2'],
      }).includes('Not yet placed'),
      expected: false,
    });
  });

  test('refuses what it cannot source', () => {
    assert({
      given: 'a source naming a task missing from the board',
      should: 'throw and name the code',
      actual: thrown(() =>
        render({ tasks: board.tasks.filter((t) => t.code !== 'DEC-7') }),
      ),
      expected: 'Watch Status source names tasks missing from the board: DEC-7',
    });
    assert({
      given: 'a source without its section markers',
      should: 'throw rather than drop a section',
      actual: thrown(() => render({}, block('Discovery', '100', 'WATCH-1'))),
      expected:
        'Watch Status source needs the <!-- standing -->, <!-- changes --> and <!-- reference --> markers',
    });
    assert({
      given: 'a Score block in a category this canvas does not have',
      should: 'throw with the area',
      actual: thrown(() =>
        render({}, source.replace('Audience experience', 'Competition')),
      ),
      expected:
        'watch-status-source.html (scripts/watch-status-source.html), Score: Discovery: unknown Category "Competition"',
    });
  });
});

describe('the committed Watch Status source', () => {
  const real = readFileSync(
    join(import.meta.dir, 'watch-status-source.html'),
    'utf8',
  );
  const named = namedCodes(real);
  const html = renderWatchStatus(
    real,
    { tasks: named.map((code) => task(code)), epicLeaves: named },
    pr,
  );

  test('renders the page the hand-kept canvas showed', () => {
    assert({
      given: 'the twelve scored areas',
      should: 'compute the overall and the furthest three',
      actual: [
        'average of 12 areas',
        'width:50%',
        'Furthest from done: Media infrastructure, Privacy and legal, Interaction.',
        '27 changes needed outside Watch itself.',
      ].every((part) => html.includes(part)),
      expected: true,
    });
    assert({
      given: 'the sections the canvas carries',
      should: 'keep each of them',
      actual: [
        'Audience experience',
        'Broadcast and recording core',
        'Trust and business',
        'Before production',
        'Other parts of the app to fix',
        'Order of work',
        'Settled requirements',
        'Concepts',
        'Earlier decisions this changes',
      ].every((part) => html.includes(part)),
      expected: true,
    });
    assert({
      given: 'the source',
      should: 'hold no board state of its own',
      actual: /pagespace\.ai|github\.com|In Progress/.test(real),
      expected: false,
    });
  });
});

const lists: Record<string, unknown> = {
  phase: {
    availableStatuses: [{ slug: 'completed', label: 'Done', group: 'done' }],
    tasks: [
      { pageId: 'i9', title: 'ISSUE-9 — moved leaf', status: 'completed' },
      { pageId: 'i8', title: 'ISSUE-8 — a neighbour', status: 'completed' },
    ],
  },
  epic: {
    availableStatuses: [
      { slug: 'pending', label: 'To Do', group: 'todo' },
      { slug: 'in_progress', label: 'In Progress', group: 'in_progress' },
    ],
    tasks: [
      {
        pageId: 'spect',
        title: 'SPECT-1 — parent',
        status: 'pending',
        subTaskCount: 1,
      },
      {
        pageId: 'wh',
        title: 'WATCH-H — Given sign-off',
        status: 'in_progress',
        subTaskCount: 0,
      },
    ],
  },
  spect: {
    availableStatuses: [{ slug: 'pending', label: 'To Do', group: 'todo' }],
    tasks: [
      {
        pageId: 's11',
        title: 'SPECT-1.1 — leaf',
        status: 'pending',
        subTaskCount: 0,
      },
    ],
  },
  issues: {
    availableStatuses: [],
    tasks: [
      { pageId: 'bucket', title: 'Pending decisions', status: 'pending' },
    ],
  },
  bucket: {
    availableStatuses: [{ slug: 'odd', label: 'Odd', group: 'done' }],
    tasks: [
      { pageId: 'd1', title: 'DEC-1 — Done thing', status: 'odd' },
      { pageId: 'd2', title: 'PENDING (owner) — no code', status: 'odd' },
      { pageId: 'd3', title: 'DEC-3 — Unknown status', status: 'gone' },
    ],
  },
};

describe('readWatchBoard', () => {
  const read = readWatchBoard(
    (id) => lists[id] as never,
    ['WATCH-H', 'ISSUE-9', 'ISSUE-404'],
    (code) => (code === 'ISSUE-9' ? 'phase' : undefined),
    { epicId: 'epic', issuesId: 'issues' },
  );

  test('finds a named task that moved off the epic and the buckets', () => {
    const codes = read.tasks.map((item) => item.code);
    assert({
      given: 'a named code living in another list',
      should: 'read it from there without its neighbours',
      actual: [codes.includes('ISSUE-9'), codes.includes('ISSUE-8')],
      expected: [true, false],
    });
    assert({
      given: 'a named code nowhere on the drive',
      should: 'leave it missing for the render to refuse',
      actual: codes.includes('ISSUE-404'),
      expected: false,
    });
    assert({
      given: 'a leaf that moved in',
      should: 'not count it as an epic leaf',
      actual: read.epicLeaves.includes('ISSUE-9'),
      expected: false,
    });
  });

  test('walks the epic and every Issues bucket', () => {
    assert({
      given: 'an epic with a parent and a sign-off leaf',
      should: 'read the leaves below the parent and count no parent as a leaf',
      actual: read.epicLeaves,
      expected: ['SPECT-1.1', 'WATCH-H'],
    });
    assert({
      given: 'a sign-off code and a bucket task',
      should: 'keep every coded task with its list’s status label and group',
      actual: read.tasks
        .filter((item) => ['WATCH-H', 'DEC-1'].includes(item.code))
        .map(({ code, statusLabel, group }) => [code, statusLabel, group]),
      expected: [
        ['WATCH-H', 'In Progress', 'in_progress'],
        ['DEC-1', 'Odd', 'done'],
      ],
    });
    assert({
      given: 'a title with no code',
      should: 'leave it out',
      actual: read.tasks.some((item) => item.pageId === 'd2'),
      expected: false,
    });
    assert({
      given: 'a status its list no longer declares',
      should: 'treat it as to do under its own slug',
      actual: read.tasks
        .filter((item) => item.code === 'DEC-3')
        .map(({ statusLabel, group }) => [statusLabel, group]),
      expected: [['gone', 'todo']],
    });
  });
});

function harness(canvas: string) {
  const writes: { before: string; after: string }[] = [];
  const output: string[] = [];
  const deps: WatchStatusDeps = {
    source: () => source,
    board: () => board,
    pr: () => pr,
    canvas: () => canvas,
    write: (before, after) => writes.push({ before, after }),
    out: (text) => output.push(text),
  };
  return { deps, writes, output };
}

describe('runWatchStatusSync', () => {
  test('a dry run reports drift and writes nothing', () => {
    const { deps, writes, output } = harness('<html>hand edited</html>');
    assert({
      given: 'a hand-edited canvas',
      should: 'exit 1',
      actual: runWatchStatusSync(deps, false),
      expected: 1,
    });
    assert({
      given: 'a dry run',
      should: 'not write and should name the command',
      actual: [writes.length, output.join('')],
      expected: [
        0,
        'Watch Status drifted from the board and its source; run bun progress:watch --apply\n',
      ],
    });
  });

  test('apply writes the render once, then has nothing to do', () => {
    const { deps, writes } = harness('old');
    runWatchStatusSync(deps, true);
    const second = harness(writes[0].after);
    assert({
      given: 'a canvas just written',
      should: 'find it in sync and write nothing on the second run',
      actual: [runWatchStatusSync(second.deps, true), second.writes.length],
      expected: [0, 0],
    });
  });

  test('a PR-only change is reported, not a failure', () => {
    const current = render();
    const { deps, writes, output } = harness(current);
    const moved = { ...deps, pr: () => ({ ...pr, isDraft: false }) };
    assert({
      given: 'only the PR state changed',
      should: 'exit 0 on a dry run and report the Now section',
      actual: [
        runWatchStatusSync(moved, false),
        writes.length,
        output.join('').includes('the Now section is out of date'),
      ],
      expected: [0, 0, true],
    });
  });
});
