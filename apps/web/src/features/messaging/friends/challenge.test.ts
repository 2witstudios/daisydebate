import { assert, setupRitewayBun, test } from 'riteway/bun';
import { challengeRoomForm } from './challenge';

setupRitewayBun();

test('challengeRoomForm', () => {
  const template = {
    formatId: 'ipda',
    formatVersion: 3,
    defaultConfig: { sample: true },
  } as never;
  const form = challengeRoomForm({
    viewer: 'ada',
    friend: 'bea',
    template,
    commandId: 'c'.repeat(24),
  });
  assert({
    given: 'two members and the default template',
    should:
      'name an unlisted casual room for them on that template and its defaults',
    actual: [
      form.get('title'),
      form.get('visibility'),
      form.get('commandId'),
      JSON.parse(String(form.get('selection'))),
      String(form.get('topic')).length > 0,
    ],
    expected: [
      '@ada vs @bea',
      'unlisted',
      'c'.repeat(24),
      {
        kind: 'catalog',
        formatId: 'ipda',
        formatVersion: 3,
        competitionType: 'casual',
        config: { sample: true },
      },
      true,
    ],
  });
});
