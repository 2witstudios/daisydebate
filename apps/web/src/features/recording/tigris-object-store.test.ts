import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTigrisObjectStore,
  readRecordingBucket,
} from './tigris-object-store';

setupRitewayBun();

const config = {
  endpoint: 'https://fly.storage.tigris.dev',
  bucket: 'private-recordings',
  accessKeyId: 'tid_example',
  secretAccessKey: 'tsec_example',
  region: 'auto',
};

describe('signedRead', () => {
  const store = createTigrisObjectStore(config);
  const url = new URL(
    store.signedRead('recordings/rec/video.mp4', {
      expiresInSeconds: 60,
      attachmentName: 'daisy-recording-rec.mp4',
    }),
  );
  test('signs one short-lived read of one key', () => {
    assert({
      given: 'a download link',
      should: 'name the key, last 60 seconds and be signed',
      actual: [
        url.pathname.endsWith('/recordings/rec/video.mp4'),
        url.searchParams.get('X-Amz-Expires'),
        url.searchParams.has('X-Amz-Signature'),
      ],
      expected: [true, '60', true],
    });
    assert({
      given: 'a download link',
      should: 'never carry the secret',
      actual: url.toString().includes(config.secretAccessKey),
      expected: false,
    });
  });
});

describe('readRecordingBucket', () => {
  test('needs every setting', () => {
    assert({
      given: 'a partial environment',
      should: 'stay inert',
      actual: readRecordingBucket({ RECORDING_BUCKET_NAME: 'x' }),
      expected: null,
    });
    assert({
      given: 'a whole environment',
      should: 'default the region',
      actual: readRecordingBucket({
        RECORDING_BUCKET_ENDPOINT: 'https://e',
        RECORDING_BUCKET_NAME: 'b',
        RECORDING_BUCKET_ACCESS_KEY_ID: 'a',
        RECORDING_BUCKET_SECRET_ACCESS_KEY: 's',
      })?.region,
      expected: 'auto',
    });
  });
});
