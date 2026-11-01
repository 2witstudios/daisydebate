import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { MediaStage } from './media-stage';
import type { MediaConnectionState } from './media-controller';
import { aff, view } from '../../ui/debate-room/live-round.test-support';

setupRitewayBun();

const render = (
  connection: MediaConnectionState,
  microphone = true,
  ownMuted = false,
  local = true,
) =>
  renderToString(
    createElement(MediaStage, {
      view,
      media: {
        peers: [{ participantId: aff.id, identity: 'local', microphone }],
      } as Parameters<typeof MediaStage>[0]['media'],
      tracks: [],
      connection,
      ownIdentity: local ? 'local' : null,
      ownMuted,
    }),
  );

test('tiles preserve refused and ended transport conditions instead of calling them reconnecting', () => {
  assert({
    given: 'no tracks after refusal and terminal stop',
    should: 'name each observed connection condition',
    actual: [
      render('denied').includes('Media refused'),
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
      render('live', true, false, false).includes('No microphone subscription'),
    ],
    expected: [true, true, true, true],
  });
});
