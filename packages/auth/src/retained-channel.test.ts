import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { input, resource } from './channel.test-support';

setupRitewayBun();

test('a retained DM refuses every channel capability (DEC-126)', () => {
  const capabilities = [
    'channel.read',
    'channel.post',
    'channel.message.remove',
    'channel.preferences.read',
    'channel.preferences.update',
    'channel.leave',
  ] as const;
  const decide = (lifecycle: 'active' | 'retained') =>
    capabilities.map(
      (capability) =>
        authorize({
          ...input,
          capability,
          resource: { ...resource, lifecycle },
        }).allow,
    );
  assert({
    given: 'the same fresh DM facts, active and then retained',
    should:
      'allow reading the active one, and refuse every capability on the retained one',
    actual: [decide('active')[0], decide('retained')],
    expected: [true, capabilities.map(() => false)],
  });
});
