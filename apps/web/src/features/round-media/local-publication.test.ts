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
        connection: 'live',
        grants: ['microphone'],
        captured: ['microphone'],
        muted: true,
      }),
      localPublicationOf({
        connection: 'unavailable',
        grants: ['microphone'],
        captured: [],
        muted: true,
      }),
      localPublicationOf({
        connection: 'live',
        grants: [],
        captured: [],
        muted: true,
      }),
    ],
    expected: ['muted', 'ill', null],
  });
});

test('publication belongs to the media lifetime rather than a control subscription', async () => {
  const {
    reportLocalPublication,
    readLocalPublication,
    subscribeLocalPublication,
  } = await import('./local-publication');
  reportLocalPublication('round:actor', 'published');
  const unsubscribe = subscribeLocalPublication('round:actor', () => undefined);
  unsubscribe();
  assert({
    given: 'a control unsubscribing while media still publishes',
    should: 'retain publication until the media producer releases it',
    actual: readLocalPublication('round:actor'),
    expected: 'published',
  });
  reportLocalPublication('round:actor', null);
});
