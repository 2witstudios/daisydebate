import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  classifyDocumentationChange,
  createDocumentationEvent,
  parseChangedFiles,
} from './docs-pipeline';

setupRitewayBun();

describe('classifyDocumentationChange', async () => {
  test('routes a public feature to technical and user documentation', async () => {
    const actual = classifyDocumentationChange({
      title: 'feat: add tournament registration',
      changedFiles: ['apps/web/src/app/tournaments/register/page.tsx'],
    });
    assert({
      given: 'a merged user-visible feature',
      should: 'route it to the technical and user documentation pipelines',
      actual: actual.pipelines,
      expected: ['user-docs'],
    });
  });

  test('does not create documentation work for a test-only change', async () => {
    const actual = classifyDocumentationChange({
      title: 'test: cover registration rejection',
      changedFiles: ['apps/web/src/features/tournaments/operations.test.ts'],
    });
    assert({
      given: 'a test-only merge',
      should: 'produce a no-op pipeline set',
      actual: actual.pipelines,
      expected: [],
    });
  });

  test('requires an explicit blog marker', async () => {
    const actual = classifyDocumentationChange({
      title: 'feat: add tournament registration',
      body: 'blog: announce this feature',
      changedFiles: ['apps/web/src/app/tournaments/register/page.tsx'],
    });
    assert({
      given: 'a feature explicitly marked for a blog post',
      should: 'include the blog pipeline',
      actual: actual.pipelines,
      expected: ['user-docs', 'blog'],
    });
  });
});

describe('createDocumentationEvent', async () => {
  test('includes stable provenance and idempotency metadata', async () => {
    const actual = createDocumentationEvent({
      eventId: 'evt-1',
      eventType: 'pull_request.merged',
      occurredAt: '2026-09-20T00:00:00.000Z',
      repository: 'daisydebate',
      baseRef: 'main',
      commit: 'abc123',
      pullRequest: {
        number: 12,
        title: 'feat: add tournaments',
        body: null,
        url: 'https://github.test/pr/12',
        author: 'alice',
        mergedBy: 'bob',
      },
      taskIds: ['ENG-1.1'],
      changedFiles: ['packages/protocol/src/events.ts'],
    });
    assert({
      given: 'a merge event',
      should: 'retain its source and stable replay key',
      actual: {
        version: actual.eventVersion,
        sourceRefs: actual.sourceRefs,
        idempotencyKey: actual.idempotencyKey,
      },
      expected: {
        version: 'docs-event-v1',
        sourceRefs: ['packages/protocol/src/events.ts'],
        idempotencyKey: 'daisydebate:abc123:pull_request.merged',
      },
    });
  });
});

describe('parseChangedFiles', async () => {
  test('normalizes comma and newline separated files', async () => {
    assert({
      given: 'a CI file list',
      should: 'return unique sorted paths',
      actual: parseChangedFiles('b.ts\na.ts,b.ts'),
      expected: ['a.ts', 'b.ts'],
    });
  });
});
