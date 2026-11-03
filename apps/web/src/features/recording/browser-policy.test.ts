import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  recordingDocumentStale,
  recordingPlaybackOrigin,
} from './browser-policy';

setupRitewayBun();

const BUCKET = 'https://fly.storage.tigris.dev';

describe('recordingPlaybackOrigin', () => {
  test('only the replay page names the bucket', () => {
    assert({
      given: 'the replay page, the archive, a deeper path and a bad value',
      should: 'answer only for the replay page with a plain origin',
      actual: [
        recordingPlaybackOrigin('/recordings/abc', `${BUCKET}/path`),
        recordingPlaybackOrigin('/recordings', BUCKET),
        recordingPlaybackOrigin('/recordings/abc/more', BUCKET),
        recordingPlaybackOrigin('/recordings/abc', 'not a url'),
        recordingPlaybackOrigin('/recordings/abc', null),
      ],
      expected: [BUCKET, null, null, null, null],
    });
  });
});

describe('recordingDocumentStale', () => {
  test('reloads only a replay page whose document was not one', () => {
    assert({
      given: 'a replay reached from the archive, loaded directly, and unknown',
      should: 'be stale only in the first case',
      actual: [
        recordingDocumentStale('https://d.test/recordings', '/recordings/a'),
        recordingDocumentStale('https://d.test/recordings/a', '/recordings/a'),
        recordingDocumentStale(undefined, '/recordings/a'),
      ],
      expected: [true, false, false],
    });
  });
});
