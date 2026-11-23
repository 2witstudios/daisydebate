import { createElement } from 'react';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ObservedTrack } from '../features/round-media/model/media-state';
import { renderMarkup } from '../test-support/rendered/markup';
import { aff, view } from '../ui/debate-room/live-round.test-support';
import { MediaStage } from '../ui/round-media/media-stage';

setupRitewayBun();

/**
 * A camera tile is a native `<video>`, which has no ARIA role, so whether one
 * was attached cannot be asked for by role and name.
 */
const observed = (muted = false): ObservedTrack =>
  ({
    identity: 'local',
    source: 'camera',
    local: false,
    speaking: false,
    muted,
  }) as const;
const handle = {
  identity: 'local',
  source: 'camera',
  track: { attach: () => undefined, detach: () => undefined },
} as never;
const stage = (tracks: readonly ObservedTrack[], handles: readonly never[]) =>
  renderMarkup(
    createElement(MediaStage, {
      view,
      media: {
        peers: [{ participantId: aff.id, identity: 'local', microphone: true }],
      } as Parameters<typeof MediaStage>[0]['media'],
      microphoneConfirmed: true,
      tracks,
      handles,
      connection: 'live',
      ownIdentity: null,
      ownMuted: false,
      remotePeers: [],
    }),
  ).includes('<video');

test('the stage shows what the model says, and only attaches what it can', () => {
  assert({
    given:
      'a camera the model reports, one it reports muted, one it does not report, and one with nothing to attach',
    should: 'render video only for the first',
    actual: [
      stage([observed()], [handle]),
      stage([observed(true)], [handle]),
      stage([], [handle]),
      stage([observed()], []),
    ],
    expected: [true, false, false, false],
  });
});
