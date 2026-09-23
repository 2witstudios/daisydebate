import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  appendRelated,
  checkReplace,
  contentHash,
  findTask,
  leafBody,
  nextCodeNumber,
  parseBoardArgs,
} from './board-model';

setupRitewayBun();

const id = 'tmzz7plnnrlz21d6qyyjp8sq';

describe('parseBoardArgs', () => {
  test('parses each command and rejects malformed input', () => {
    assert({
      given: 'valid read, status, relate, create and replace invocations',
      should: 'return typed commands',
      actual: [
        parseBoardArgs(['read', id]),
        parseBoardArgs(['status', id, 'in_review']),
        parseBoardArgs(['relate', id, 'Review', 'pm17nmf831vkr3o84wbo2ofh']),
        parseBoardArgs([
          'create',
          'cy7vznqfbs8ikfwj1qu8xxnm',
          '--issue',
          '--title',
          'Given X, should Y',
          '--criterion',
          'Given A, should B',
          '--related',
          'Origin=pm17nmf831vkr3o84wbo2ofh',
        ]),
        parseBoardArgs([
          'replace',
          id,
          '--start',
          '3',
          '--end',
          '4',
          '--expect-lines',
          '40',
          '--file',
          'new.html',
        ]),
      ],
      expected: [
        { command: 'read', pageId: id },
        { command: 'status', pageId: id, status: 'in_review' },
        {
          command: 'relate',
          pageId: id,
          label: 'Review',
          target: 'pm17nmf831vkr3o84wbo2ofh',
        },
        {
          command: 'create',
          listId: 'cy7vznqfbs8ikfwj1qu8xxnm',
          prefix: 'ISSUE',
          title: 'Given X, should Y',
          criteria: ['Given A, should B'],
          related: [{ label: 'Origin', id: 'pm17nmf831vkr3o84wbo2ofh' }],
        },
        {
          command: 'replace',
          pageId: id,
          start: 3,
          end: 4,
          expectLines: 40,
          file: 'new.html',
          oldFile: undefined,
        },
      ],
    });
  });

  test('refuses unsafe or malformed arguments with a usage message', () => {
    const errors = [
      parseBoardArgs(['read', '../etc/passwd']),
      parseBoardArgs(['status', id, 'In Review']),
      parseBoardArgs(['replace', id, '--start', '3', '--file', 'x']),
      parseBoardArgs(['create', id, '--title', 'x', '--related', 'bad']),
      parseBoardArgs(['create', id]),
      parseBoardArgs(['launch']),
    ].map((result) => 'error' in result);
    assert({
      given:
        'a non-id page, a label instead of a slug, a replace without --expect-lines, a bad related entry, a missing title and an unknown command',
      should: 'return an error for each',
      actual: errors,
      expected: [true, true, true, true, true, true],
    });
  });
});

describe('findTask', () => {
  test('finds the task row that owns a task page', () => {
    const list = {
      tasks: [
        { id: 't1', pageId: 'p1', title: 'A' },
        { id: 't2', pageId: 'p2', title: 'B' },
      ],
      availableStatuses: [{ slug: 'in_review' }],
    };
    assert({
      given: 'a task list and a task page id',
      should: 'return the task id and the valid status slugs',
      actual: [findTask(list, 'p2'), findTask(list, 'p9')],
      expected: [{ taskId: 't2', statuses: ['in_review'] }, undefined],
    });
  });
});

describe('nextCodeNumber', () => {
  test('continues after the highest ISSUE-n', () => {
    assert({
      given: 'issue titles out of order plus a non-issue',
      should: 'return one more than the highest number',
      actual: [
        nextCodeNumber(
          ['ISSUE-2 — a', 'ISSUE-14 — b', 'Other', 'ISSUE-9 — c', 'DEC-40 — d'],
          'ISSUE',
        ),
        nextCodeNumber(['ISSUE-2 — a'], 'DEC'),
      ],
      expected: [15, 1],
    });
  });
});

describe('leafBody and appendRelated', () => {
  const body = leafBody({
    criteria: ['Given <a>, should "b"'],
    related: [{ label: 'Origin', id: 'p1', title: 'PR & review' }],
  });

  test('writes criteria bullets above an escaped Related pages block', () => {
    assert({
      given: 'a criterion and a related page',
      should: 'escape HTML and mention the page',
      actual: body,
      expected: [
        '<ul>',
        '<li>',
        'Given &lt;a&gt;, should &quot;b&quot;',
        '</li>',
        '</ul>',
        '<h3>',
        'Related pages',
        '</h3>',
        '<ul>',
        '<li>',
        'Origin: <a class="mention" data-mention-type="page" data-page-id="p1">@PR &amp; review</a>',
        '</li>',
        '</ul>',
      ].join('\n'),
    });
  });

  test('appends to the Related pages block without touching criteria', () => {
    const appended = appendRelated(body, {
      label: 'Review',
      id: 'p2',
      title: 'Review record',
    });
    assert({
      given: 'a page with a Related pages block',
      should: 'add one entry at the end of that block only',
      actual: [
        appended.startsWith(body.slice(0, body.lastIndexOf('</ul>'))),
        appended.endsWith(
          '<li>\nReview: <a class="mention" data-mention-type="page" data-page-id="p2">@Review record</a>\n</li>\n</ul>',
        ),
      ],
      expected: [true, true],
    });
  });

  test('adds a Related pages block when the page has none', () => {
    assert({
      given: 'a page without the block',
      should: 'append a new block',
      actual: appendRelated('<p>x</p>', {
        label: 'Plan',
        id: 'p3',
        title: 'P',
      }),
      expected:
        '<p>x</p>\n<h3>\nRelated pages\n</h3>\n<ul>\n<li>\nPlan: <a class="mention" data-mention-type="page" data-page-id="p3">@P</a>\n</li>\n</ul>',
    });
  });

  test('keeps placeholders that look like tags intact', () => {
    assert({
      given: 'a page whose text holds debate:<id>:presence',
      should: 'leave it byte for byte',
      actual: appendRelated('<p>debate:&lt;id&gt;:presence</p>', {
        label: 'Plan',
        id: 'p3',
        title: 'P',
      }).startsWith('<p>debate:&lt;id&gt;:presence</p>'),
      expected: true,
    });
  });
});

describe('checkReplace', () => {
  const current = ['a', 'b', 'c', 'd'].join('\n');

  test('allows a replace when the page is unchanged', () => {
    assert({
      given: 'the expected line count and old text',
      should: 'allow it',
      actual: checkReplace(current, {
        start: 2,
        end: 3,
        expectLines: 4,
        oldText: 'b\nc',
      }),
      expected: undefined,
    });
  });

  test('refuses a replace whose expected hash is not the current content', () => {
    const input = { start: 2, end: 3, expectLines: 4 };
    assert({
      given: 'an expected hash of other content, then of the current content',
      should: 'refuse the first and allow the second',
      actual: [
        checkReplace(current, {
          ...input,
          expectHash: contentHash('a\nx\nc\nd'),
        }),
        checkReplace(current, { ...input, expectHash: contentHash(current) }),
      ],
      expected: [
        'The page changed since you read it (content hash differs). Read it again.',
        undefined,
      ],
    });
  });

  test('allows a whole-page replace of a page that ends with a newline', () => {
    const trailing = 'a\nb\n';
    assert({
      given: 'an unchanged page ending in a newline and its saved copy',
      should: 'allow it',
      actual: checkReplace(trailing, {
        start: 1,
        end: 3,
        expectLines: 3,
        oldText: trailing,
      }),
      expected: undefined,
    });
  });

  test('refuses a replace after a concurrent edit', () => {
    assert({
      given: 'a changed line count, changed old text, and an out-of-range end',
      should: 'refuse each with a reason',
      actual: [
        checkReplace(current, { start: 2, end: 3, expectLines: 5 }),
        checkReplace(current, {
          start: 2,
          end: 3,
          expectLines: 4,
          oldText: 'b\nX',
        }),
        checkReplace(current, { start: 2, end: 9, expectLines: 4 }),
      ],
      expected: [
        'The page has 4 lines, not 5: someone edited it. Read it again.',
        'Lines 2-3 changed since you read them. Read the page again.',
        'Lines 2-9 are outside the page (4 lines).',
      ],
    });
  });
});
