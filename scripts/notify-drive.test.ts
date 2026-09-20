import { describe, test } from 'riteway/bun';
import { setupRitewayBun, assert } from 'riteway/bun';
import {
  composeIncidentMessage,
  composeMergeMessage,
  extractTaskIds,
  signPayload,
} from './notify-drive';

setupRitewayBun();

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
