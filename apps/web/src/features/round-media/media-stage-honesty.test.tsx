import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MediaStage } from './media-stage';
import type { RemotePeer } from './browser-transport';
import type { MediaConnectionState } from './media-controller';
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
      render('live', false, true).includes('Waiting for microphone permission'),
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
    actual: remote(false, present(false)).includes(
      'Waiting for microphone permission',
    ),
    expected: true,
  });
});
