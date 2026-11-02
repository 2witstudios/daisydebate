import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MediaStage } from './media-stage';
import type { ObservedPeer as RemotePeer } from './model/media-state';
import type { MediaConnectionLabel as MediaConnectionState } from './model/media-status';
import { aff, view } from '../../ui/debate-room/live-round.test-support';

setupRitewayBun();

const render = (
  connection: MediaConnectionState,
  microphone = true,
  ownMuted = false,
  local = true,
  remotePeers: readonly RemotePeer[] = [],
) =>
  renderToString(
    createElement(MediaStage, {
      view,
      media: {
        peers: [{ participantId: aff.id, identity: 'local', microphone }],
      } as Parameters<typeof MediaStage>[0]['media'],
      microphoneConfirmed: true,
      tracks: [],
      handles: [],
      connection,
      ownIdentity: local ? 'local' : null,
      ownMuted,
      remotePeers,
    }),
  );

test('tiles preserve unavailable and ended transport conditions instead of calling them reconnecting', () => {
  assert({
    given: 'no tracks after release and terminal stop',
    should: 'name each observed connection condition',
    actual: [
      render('unavailable').includes('Media unavailable'),
      render('ended').includes('Call ended'),
    ],
    expected: [true, true],
  });
});

test('tiles distinguish mute, floor permission, missing publication and missing subscription', () => {
  assert({
    given:
      'a local muted mic, local ungranted mic, local granted without track and remote granted without track',
    should: 'name only the known media state without claiming audibility',
    actual: [
      render('live', true, true).includes('You muted your microphone'),
      render('live', false, true).includes('Microphone closed'),
      render('live').includes('Microphone not publishing'),
    ],
    expected: [true, true, true],
  });
});

test('a remote seat says what the transport actually observes of that peer', () => {
  const remote = (microphone: boolean, peers: readonly RemotePeer[]) =>
    render('live', microphone, false, false, peers);
  const present = (microphonePublished: boolean): readonly RemotePeer[] => [
    { identity: 'local', microphonePublished },
  ];
  assert({
    given:
      'a granted peer who dropped, one publishing nothing, one published but unsubscribed',
    should: 'name disconnection, absent publication and missing subscription',
    actual: [
      remote(true, []).includes('Disconnected from media'),
      remote(true, present(false)).includes('Microphone not publishing'),
      remote(true, present(true)).includes('No microphone subscription'),
    ],
    expected: [true, true, true],
  });
  assert({
    given: 'an ungranted peer who dropped from the media room',
    should: 'report the drop rather than an awaited permission',
    actual: remote(false, []).includes('Disconnected from media'),
    expected: true,
  });
  assert({
    given: 'an ungranted peer still connected',
    should: 'report the floor, not a device problem',
    actual: remote(false, present(false)).includes('Microphone closed'),
    expected: true,
  });
});

const observed = (muted = false) =>
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
const stage = (
  tracks: readonly ReturnType<typeof observed>[],
  handles: readonly never[],
) =>
  renderToString(
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
