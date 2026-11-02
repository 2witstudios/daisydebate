import { assert, setupRitewayBun, test } from 'riteway/bun';
import { localPublicationOf } from './local-publication';

setupRitewayBun();

test('a deliberately muted microphone requires actual publication evidence and a live grant', () => {
  assert({
    given:
      'a muted publication included in transport evidence, and absent, disconnected or ungranted variants',
    should: 'report muted only while connected and permitted',
    actual: [
      localPublicationOf({
        failure: null,
        connection: 'live',
        grants: ['microphone'],
        captured: ['microphone'],
        muted: true,
      }),
      localPublicationOf({
        failure: 'transient',
        connection: 'unavailable',
        grants: ['microphone'],
        captured: [],
        muted: true,
      }),
      localPublicationOf({
        failure: null,
        connection: 'live',
        grants: [],
        captured: [],
        muted: true,
      }),
    ],
    expected: ['muted', 'ill', null],
  });
});

test('reads running late do not call a published microphone reconnecting', () => {
  const during = (connection: 'out-of-date' | 'reconnecting') =>
    localPublicationOf({
      failure: null,
      connection,
      grants: ['microphone'],
      captured: ['microphone'],
      muted: false,
    });
  assert({
    given:
      'a microphone track still up while reads are out of date, then a real reconnect',
    should:
      'keep saying published, and say ill only when the connection is gone',
    actual: [during('out-of-date'), during('reconnecting')],
    expected: ['published', 'ill'],
  });
});

test('only what recovery is working on says it is reconnecting', () => {
  const released = (
    connection: 'reconnecting' | 'unavailable' | 'connecting',
    failure: 'transient' | 'definite' | 'refused' | 'replaced' | null,
  ) =>
    localPublicationOf({
      connection,
      failure,
      grants: undefined,
      captured: [],
      muted: false,
    });
  assert({
    given: 'what the session passes while released, for each outcome',
    should:
      'say ill while recovery works, disconnected when it will not, and nothing before a connection',
    actual: [
      released('reconnecting', null),
      released('unavailable', 'transient'),
      released('unavailable', 'definite'),
      released('unavailable', 'refused'),
      released('unavailable', 'replaced'),
      released('connecting', null),
    ],
    expected: [
      'ill',
      'ill',
      'disconnected',
      'disconnected',
      'disconnected',
      null,
    ],
  });
});
