import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { boundEvent, EVENT_MAX_CHARS } from './docs-event-bound';
import { createDocumentationEvent } from './docs-pipeline';

setupRitewayBun();

// Built the way dispatch builds it, so sourceRefs defaults to changedFiles.
const event = ({
  body = '',
  files = 3,
  title = 'feat(formats): the whole slice',
}: {
  body?: string;
  files?: number;
  title?: string;
}) =>
  createDocumentationEvent({
    eventId: '1001-merge007',
    eventType: 'pull_request.merged',
    occurredAt: '2026-09-20T00:00:00.000Z',
    repository: '2witstudios/daisydebate',
    baseRef: 'main',
    commit: 'merge007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    pullRequest: {
      number: 7,
      title,
      body: body || null,
      url: 'https://github.com/2witstudios/daisydebate/pull/7',
      author: '2witstudios',
      mergedBy: '2witstudios',
    },
    taskIds: [],
    changedFiles: Array.from(
      { length: files },
      (_, index) => `apps/web/src/features/formats/file-${index}.ts`,
    ),
  });

const fits = (value: unknown) =>
  JSON.stringify(value).length <= EVENT_MAX_CHARS;

describe('boundEvent', () => {
  test('passes a small event through untouched', () => {
    const small = event({ body: 'A short body.' });
    assert({
      given: 'an event well under the cap',
      should: 'return it unchanged with nothing omitted',
      actual: boundEvent(small),
      expected: { event: small, omitted: [] },
    });
  });

  test('drops the duplicate source refs before anything a reader needs', () => {
    const { event: bounded, omitted } = boundEvent(
      event({ body: 'b'.repeat(2_000), files: 60 }),
    );
    assert({
      given:
        'a 2,000-character body and 60 changed files, whose sourceRefs repeat them',
      should:
        'fit by dropping the duplicate refs, keeping the body and every file',
      actual: {
        fits: fits(bounded),
        body: bounded.pullRequest?.body?.length,
        files: bounded.changedFiles.length,
        refs: bounded.sourceRefs.length,
        omitted,
      },
      expected: {
        fits: true,
        body: 2_000,
        files: 60,
        refs: 0,
        omitted: ['the source refs (the same 60 paths as the changed files)'],
      },
    });
  });

  test('keeps part of a long body and part of a long file list', () => {
    const { event: bounded, omitted } = boundEvent(
      event({ body: 'x'.repeat(20_000), files: 400 }),
    );
    assert({
      given: 'a 20,000-character body and 400 changed files',
      should:
        'fit the cap while keeping a useful share of both, and count what it left out',
      actual: {
        fits: fits(bounded),
        bodyKept: (bounded.pullRequest?.body?.length ?? 0) >= 2_000,
        bodyMarked: bounded.pullRequest?.body?.endsWith('… [cut]'),
        someFiles: bounded.changedFiles.length > 0,
        notes: omitted.map((note) => note.replace(/^\d+/, 'N')),
      },
      expected: {
        fits: true,
        bodyKept: true,
        bodyMarked: true,
        someFiles: true,
        notes: [
          'the source refs (the same 400 paths as the changed files)',
          'N of 20000 characters of the PR body',
          'N of 400 changed files',
        ],
      },
    });
  });

  test('measures the body share on its serialized size', () => {
    const { event: bounded } = boundEvent(
      event({ body: '"\n'.repeat(5_000), files: 50 }),
    );
    assert({
      given:
        'a 10,000-character body of quotes and newlines and 50 changed files',
      should:
        'keep some of the file list instead of letting escapes crowd it out',
      actual: {
        fits: fits(bounded),
        someFiles: bounded.changedFiles.length > 0,
      },
      expected: { fits: true, someFiles: true },
    });
  });

  test('caps the whole event, title included, and names only real cuts', () => {
    const { event: bounded, omitted } = boundEvent(
      event({ title: 't'.repeat(7_000), files: 0 }),
    );
    assert({
      given: 'a 7,000-character title, no body and no files',
      should: 'fit the cap by cutting the title, with one note for it',
      actual: {
        fits: fits(bounded),
        notes: omitted.map((note) => note.replace(/^\d+/, 'N')),
      },
      expected: {
        fits: true,
        notes: ['N of 7000 characters of the PR title'],
      },
    });
  });
});
