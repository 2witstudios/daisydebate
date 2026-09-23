import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { runBoard, type BoardDeps } from './board';

setupRitewayBun();

const task = 'tmzz7plnnrlz21d6qyyjp8sq';
const list = 'j03yzhn6d98wd25hlqdpxntj';
const plan = 'pm17nmf831vkr3o84wbo2ofh';
const page = '<ul>\n<li>\nGiven A, should B\n</li>\n</ul>';

function fakeBoard(content = page, autonomous = false) {
  const calls: string[][] = [];
  const written: string[] = [];
  const output: string[] = [];
  const deps: BoardDeps = {
    pagespace: (args) => {
      calls.push([...args]);
      const key = args.slice(0, 2).join(' ');
      if (key === 'pages read' && args.includes('--raw'))
        return { code: 0, stdout: content };
      if (key === 'pages read')
        return { code: 0, stdout: JSON.stringify({ content }) };
      if (key === 'pages read-details')
        return {
          code: 0,
          stdout: JSON.stringify({
            title: args[2] === plan ? 'Plan — X' : 'Leaf',
            parentId: list,
          }),
        };
      if (key === 'tasks list')
        return {
          code: 0,
          stdout: JSON.stringify({
            tasks: [{ id: 'task-row', pageId: task, title: 'ISSUE-3 — a' }],
            availableStatuses: [{ slug: 'in_progress' }, { slug: 'in_review' }],
          }),
        };
      if (key === 'pages replace-lines') {
        written.push(readFileSync(args[args.indexOf('--file') + 1], 'utf8'));
        return { code: 0, stdout: '' };
      }
      return { code: 0, stdout: '{}' };
    },
    readFile: () => 'b',
    autonomous,
    scratch: (name) => join(tmpdir(), `board-test-${process.pid}-${name}`),
    out: (text) => void output.push(text),
  };
  return { deps, calls, written, output };
}

describe('bun board:*', () => {
  test('reads a page raw, placeholders included', () => {
    const board = fakeBoard('<p>debate:&lt;id&gt;:presence</p>');
    runBoard(board.deps, ['read', task]);
    assert({
      given: 'a page holding a placeholder',
      should: 'print the raw content unchanged',
      actual: board.output.join(''),
      expected: '<p>debate:&lt;id&gt;:presence</p>',
    });
  });

  test('moves a task page to a status its list defines', () => {
    const board = fakeBoard();
    const code = runBoard(board.deps, ['status', task, 'in_review']);
    assert({
      given: 'a task page id and a valid status',
      should: 'update the task row in its parent list',
      actual: [code, board.calls.at(-1)],
      expected: [
        0,
        ['tasks', 'update', list, 'task-row', '--status', 'in_review'],
      ],
    });
  });

  test('refuses a status the list does not define', () => {
    const board = fakeBoard();
    assert({
      given: 'an unknown status slug',
      should: 'exit 1 without updating',
      actual: [
        runBoard(board.deps, ['status', task, 'merged']),
        board.calls.some((call) => call[1] === 'update'),
      ],
      expected: [1, false],
    });
  });

  test('refuses Done from an autonomous agent and allows it for the owner', () => {
    const agent = fakeBoard(page, true);
    const owner = fakeBoard();
    assert({
      given: 'board:status completed from an agent and from the owner',
      should:
        'refuse the agent before any call, naming the review record, and let the owner through to the list check',
      actual: [
        runBoard(agent.deps, ['status', task, 'completed']),
        agent.calls.length,
        agent.output.join('').includes('independent review record'),
        runBoard(owner.deps, ['status', task, 'completed']) !== 2 &&
          owner.calls.length > 0,
      ],
      expected: [2, 0, true, true],
    });
  });

  test('appends to Related pages with a concurrency guard', () => {
    const board = fakeBoard();
    runBoard(board.deps, ['relate', task, 'Plan', plan]);
    const replace = board.calls.find((call) => call[1] === 'replace-lines');
    assert({
      given: 'a leaf and a page to relate',
      should: 'write the page back guarded by its line count',
      actual: [
        replace?.slice(replace.indexOf('--expect-lines'), -2),
        board.written[0]?.endsWith(
          `Plan: <a class="mention" data-mention-type="page" data-page-id="${plan}">@Plan — X</a>\n</li>\n</ul>`,
        ),
      ],
      expected: [['--expect-lines', '5'], true],
    });
  });

  test('refuses a replace when the page changed underneath', () => {
    const board = fakeBoard();
    const code = runBoard(board.deps, [
      'replace',
      task,
      '--start',
      '2',
      '--end',
      '2',
      '--expect-lines',
      '9',
      '--file',
      'new.html',
    ]);
    assert({
      given: 'an expected line count that no longer matches',
      should: 'exit 1 without sending the replace',
      actual: [code, board.calls.some((call) => call[1] === 'replace-lines')],
      expected: [1, false],
    });
  });

  test('prints usage for malformed arguments', () => {
    const board = fakeBoard();
    assert({
      given: 'an unknown command',
      should: 'exit 2 and call nothing',
      actual: [runBoard(board.deps, ['nuke', task]), board.calls.length],
      expected: [2, 0],
    });
  });
});
