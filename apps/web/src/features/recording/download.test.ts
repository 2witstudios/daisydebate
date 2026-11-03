import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RecordingViewer } from './audience';
import { openDownload, type RecordingDownloadChoice } from './download';
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
  const download = (
    d: ReturnType<typeof deps>,
    viewer: RecordingViewer,
    choice: RecordingDownloadChoice = { kind: 'composite' },
  ) =>
    openDownload(d, {
      recordingId: 'rec',
      choice,
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

  const withPovs = () => {
    const ready = record();
    if (ready.lifecycle.status !== 'ready') throw new Error('fixture');
    return record({
      lifecycle: {
        ...ready.lifecycle,
        media: {
          ...ready.lifecycle.media,
          povs: [
            {
              status: 'built',
              roundParticipantId: 'seat-aff',
              video: {
                key: `${prefix}pov/seat-aff/video.mp4`,
                byteSize: 9,
                quality: '360p',
              },
              audio: { key: `${prefix}pov/seat-aff/audio.m4a`, byteSize: 3 },
              durationMs: 60_000,
              gaps: [],
            },
            {
              status: 'built',
              roundParticipantId: 'seat-bot',
              video: null,
              audio: { key: `${prefix}pov/seat-bot/audio.m4a`, byteSize: 3 },
              durationMs: 60_000,
              gaps: [],
            },
            {
              status: 'missing',
              roundParticipantId: 'seat-neg',
              reason: 'build_failed',
            },
          ],
        },
      },
    });
  };
  const pov = (roundParticipantId: string, file: 'video' | 'audio') =>
    ({ kind: 'pov', roundParticipantId, file }) as const;

  test('gives a POV as its own attachment, on the same rule', async () => {
    assert({
      given: "a subscriber asking for a debater's video and audio",
      should: 'sign each file, named by seat and never by a person',
      actual: [
        await download(
          deps(withPovs()),
          account('stranger'),
          pov('seat-aff', 'video'),
        ),
        await download(
          deps(withPovs()),
          account('stranger'),
          pov('seat-aff', 'audio'),
        ),
      ],
      expected: [
        `https://store.test/${prefix}pov/seat-aff/video.mp4?expires=60&attachment=daisy-recording-rec-seat-aff.mp4`,
        `https://store.test/${prefix}pov/seat-aff/audio.m4a?expires=60&attachment=daisy-recording-rec-seat-aff.m4a`,
      ],
    });
  });

  test('refuses a POV that has no such file, and any viewer the composite refuses', async () => {
    for (const [given, attempt] of [
      [
        'a missing POV',
        () =>
          download(deps(withPovs()), account('aff'), pov('seat-neg', 'audio')),
      ],
      [
        'a video of a debater with no camera',
        () =>
          download(deps(withPovs()), account('aff'), pov('seat-bot', 'video')),
      ],
      [
        'a seat that is not in it, such as a judge',
        () => download(deps(withPovs()), account('aff'), pov('judge', 'audio')),
      ],
      [
        'a member without the entitlement',
        () =>
          download(
            deps(withPovs(), { subscribed: false }),
            account('aff'),
            pov('seat-aff', 'audio'),
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
