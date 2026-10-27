import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '@daisy/protocol/authorization';
import { authorize } from './authorization';
import { input, resource } from './channel.test-support';

setupRitewayBun();

test('a retained DM refuses every channel capability (DEC-126)', () => {
  // Every channel capability the protocol defines, so a new one is pinned too.
  const capabilities = authorizationCapabilitySchema.options.filter(
    (capability) => capability.startsWith('channel.'),
  );
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
      'allow reading the active one, and refuse every one of the protocol channel capabilities on the retained one',
    actual: [
      decide('active')[capabilities.indexOf('channel.read')],
      decide('retained'),
      capabilities.includes('channel.subscribe'),
    ],
    expected: [true, capabilities.map(() => false), true],
  });
});
