import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  CHANNELS,
  composeIncidentMessage,
  composeMergeMessage,
  extractTaskIds,
  postDocumentationEvent,
  signPayload,
} from './notify-drive';

setupRitewayBun();

describe('CHANNELS', async () => {
  test('provides the four designated PageSpace channels', async () => {
    assert({
      given: 'the notify-drive channel registry',
      should:
        'list standup, epic-updates, sprint-room and incidents as valid channels',
      actual: [...CHANNELS].sort(),
      expected: ['epic-updates', 'incidents', 'sprint-room', 'standup'],
    });
  });
});

describe('extractTaskIds', async () => {
  test('extracts epic leaf IDs from commit text', async () => {
    assert({
      given: 'text containing task IDs and noise',
      should: 'return the unique task IDs in order',
      actual: extractTaskIds(
        'fix/eng-1.1-lobby ENG-1.1 and MTCH-2.1, ENG-1.1 (#12)',
      ),
      expected: ['ENG-1.1', 'MTCH-2.1'],
    });
  });

  test('returns empty for text without task IDs', async () => {
    assert({
      given: 'text without task IDs',
      should: 'return an empty array',
      actual: extractTaskIds('chore: no references here'),
      expected: [],
    });
  });

  test('filters technical-acronym false positives', async () => {
    assert({
      given: 'text with HTTP status codes and CI references alongside a real task',
      should: 'keep only the real task ID',
      actual: extractTaskIds('returns HTTP-200 and CI-123 logs for ENG-1.1'),
      expected: ['ENG-1.1'],
    });
  });
});

describe('signPayload', async () => {
  test('matches the PageSpace v0 HMAC scheme', async () => {
    assert({
      given: 'a secret, timestamp, and body',
      should: 'sign v0:{timestamp}:{body} with HMAC-SHA256 as v0=<hex>',
      actual: signPayload('test-secret', 1700000000, 'hello'),
      expected:
        'v0=942d6b74018da01b556b4a04b52b2c54e4e34a9e33dab5b18498b8b7054fe027',
    });
  });
});

describe('composeIncidentMessage', async () => {
  test('renders the failure summary', async () => {
    assert({
      given: 'CI failure details',
      should: 'compose a channel message with ref, run link, sha, and tasks',
      actual: composeIncidentMessage({
        ref: 'main',
        sha: 'abc1234',
        runUrl: 'https://ci.test/run/1',
        taskIds: ['ENG-1.1'],
      }),
      expected:
        '🔴 CI failed — daisydebate@main\nhttps://ci.test/run/1\ncommit abc1234\nTasks: ENG-1.1',
    });
  });
});

describe('composeMergeMessage', async () => {
  test('renders the merge summary', async () => {
    assert({
      given: 'merge details',
      should: 'compose a channel message with PR, link, sha, base, and tasks',
      actual: composeMergeMessage({
        pr: 12,
        title: 'feat: lobby',
        url: 'https://github.test/pr/12',
        sha: 'abc1234',
        base: 'main',
        taskIds: [],
      }),
      expected:
        '✅ Merged #12 — feat: lobby\nhttps://github.test/pr/12\nabc1234 → main\nTasks: none referenced',
    });
  });
});

describe('postDocumentationEvent', async () => {
  test('rejects a webhook URL that is not https', async () => {
    const originalUrl = process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL;
    const originalSecret =
      process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_SECRET;
    process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL =
      'http://pagespace.ai/api/webhooks/token';
    process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_SECRET = 'test-secret';

    try {
      let thrown: unknown;
      try {
        await postDocumentationEvent({
          eventVersion: 'docs-event-v1',
          eventId: 'evt-1',
          eventType: 'pull_request.merged',
          occurredAt: '2026-09-20T00:00:00.000Z',
          repository: 'daisydebate',
          baseRef: 'main',
          commit: 'abc123',
          pullRequest: null,
          taskIds: [],
          changedFiles: [],
          classification: {
            changeKind: 'unknown',
            pipelines: [],
            reasons: [],
          },
          sourceRefs: [],
          idempotencyKey: 'daisydebate:abc123:pull_request.merged',
        });
      } catch (error) {
        thrown = error;
      }

      assert({
        given: 'an http webhook URL',
        should: 'reject before sending the signed event',
        actual: thrown instanceof Error && thrown.message.includes('https'),
        expected: true,
      });
    } finally {
      if (originalUrl)
        process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL = originalUrl;
      else delete process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_URL;
      if (originalSecret)
        process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_SECRET =
          originalSecret;
      else delete process.env.PAGESPACE_DOCUMENTATION_AGENT_WEBHOOK_SECRET;
    }
  });
});
