import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import { openDownload } from './download';
import {
  account,
  at,
  deps,
  prefix,
  record,
  round,
  visitor,
} from './fixture.test-support';

setupRitewayBun();

describe('openDownload', () => {
  const download = (d: ReturnType<typeof deps>, viewer: RecordingViewer) =>
    openDownload(d, {
      recordingId: 'rec',
      viewer,
      presentedLinkHashOf: () => null,
    });

  test('gives a subscriber a short-lived attachment', async () => {
    assert({
      given: 'a subscriber who may watch',
      should: 'sign the whole video as an attachment for 60 seconds',
      actual: await download(deps(), account('stranger')),
      expected: `https://store.test/${prefix}video.mp4?expires=60&attachment=daisy-recording-rec.mp4`,
    });
  });

  test('refuses everything else on the server', async () => {
    for (const [given, attempt] of [
      [
        'a member without the entitlement',
        () =>
          download(deps(record(), { subscribed: false }), account('stranger')),
      ],
      ['a visitor', () => download(deps(), visitor)],
      [
        'a subscriber who may not watch it',
        () =>
          download(
            deps(record(), { round: { ...round, visibility: 'private' } }),
            account('stranger'),
          ),
      ],
      [
        'a Recording taken down',
        () =>
          download(
            deps(
              record({
                lifecycle: {
                  status: 'taken_down',
                  takenDownAt: at,
                  held: null,
                },
              }),
            ),
            account('aff'),
          ),
      ],
      [
        'a Recording removed by erasure',
        () =>
          download(
            deps(
              record({
                lifecycle: {
                  status: 'removing',
                  cause: 'participant_request',
                  requestedAt: at,
                },
              }),
            ),
            account('aff'),
          ),
      ],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse',
        actual: attempt,
        code: 'NOT_FOUND',
      });
  });
});
