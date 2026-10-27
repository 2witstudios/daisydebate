import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { boundEvent, EVENT_MAX_CHARS } from './docs-event-bound';
import { mergeEvent } from './docs-consult.test-support';

setupRitewayBun();

const withPr = (body: string, files: number) => {
  const event = mergeEvent('feat(formats): the whole slice');
  return {
    ...event,
    pullRequest: event.pullRequest && { ...event.pullRequest, body },
    changedFiles: Array.from(
      { length: files },
      (_, index) => `apps/web/src/features/formats/file-${index}.ts`,
    ),
  };
};

describe('boundEvent', () => {
  test('passes a small event through untouched', () => {
    const event = withPr('A short body.', 3);
    assert({
      given: 'an event well under the cap',
      should: 'return it unchanged with nothing omitted',
      actual: boundEvent(event),
      expected: { event, omitted: [] },
    });
  });

  test('shortens a long PR body first and says so', () => {
    const { event, omitted } = boundEvent(withPr('x'.repeat(20_000), 3));
    assert({
      given: 'a 20,000-character PR body and three changed files',
      should:
        'fit the cap by cutting only the body, keeping every file and naming the cut',
      actual: {
        fits: JSON.stringify(event).length <= EVENT_MAX_CHARS,
        files: event.changedFiles.length,
        bodyEndsWithMarker: event.pullRequest?.body?.endsWith('… [cut]'),
        omitted: omitted.map((note) => note.replace(/\d+ of/, 'N of')),
      },
      expected: {
        fits: true,
        files: 3,
        bodyEndsWithMarker: true,
        omitted: ['the PR body (N of 20000 characters kept)'],
      },
    });
  });

  test('drops trailing changed files once the body is gone and still too long', () => {
    const { event, omitted } = boundEvent(withPr('y'.repeat(20_000), 400));
    assert({
      given: 'a long body and 400 changed files',
      should:
        'fit the cap, keep the first files and count the ones it left out',
      actual: {
        fits: JSON.stringify(event).length <= EVENT_MAX_CHARS,
        firstKept: event.changedFiles[0],
        notes: omitted.length,
        filesNote: /^\d+ of 400 changed files$/.test(omitted[1] ?? ''),
      },
      expected: {
        fits: true,
        firstKept: 'apps/web/src/features/formats/file-0.ts',
        notes: 2,
        filesNote: true,
      },
    });
  });
});
