import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  authorizeRequest,
  requireAuthorization,
} from './request-authorization';
import { input as groupInput } from './group-invitation.test-support';
import { input as channelInput, pendingResource } from './channel.test-support';
setupRitewayBun();
const deniedPrincipal = {
  kind: 'user',
  userId: 'foreign-user',
  actorId: 'foreign-actor',
} as const;
const reads = [
  { ...groupInput, capability: 'channel.invitation.read' as const },
  {
    ...channelInput,
    resource: pendingResource,
    capability: 'channel.request.status' as const,
  },
];
for (const candidate of reads)
  test(`${candidate.capability} masks absent and denied metadata identically`, async () => {
    for (const projection of [
      null,
      { resource: candidate.resource, context: candidate.context },
    ]) {
      await assertRejects({
        given: `missing or denied ${candidate.capability} metadata`,
        should: 'expose only NOT_FOUND',
        actual: () =>
          authorizeRequest({
            identity: {
              state: 'member',
              username: 'reader',
              principal: deniedPrincipal,
            },
            capability: candidate.capability,
            load: async () => projection,
          }),
        code: 'NOT_FOUND',
      });
    }
    await assertRejects({
      given: `anonymous ${candidate.capability} metadata read`,
      should:
        'mask existence rather than disclose authentication or authorization detail',
      actual: () =>
        requireAuthorization({
          ...candidate,
          principal: { kind: 'anonymous' },
        }),
      code: 'NOT_FOUND',
    });
  });
test('metadata masking preserves mutation and infrastructure error boundaries', async () => {
  for (const capability of [
    'channel.invitation.accept',
    'channel.invitation.decline',
    'channel.invitation.cancel',
    'channel.invitation.result',
  ] as const) {
    await assertRejects({
      given: `unbound member ${capability}`,
      should: 'retain mutation authorization refusal',
      actual: () =>
        requireAuthorization({
          ...groupInput,
          principal: deniedPrincipal,
          capability,
        }),
      code: 'AUTHORIZATION',
    });
  }
  await assertRejects({
    given: 'anonymous invitation mutation',
    should: 'retain authentication refusal',
    actual: () =>
      requireAuthorization({
        ...groupInput,
        principal: { kind: 'anonymous' },
        capability: 'channel.invitation.accept',
      }),
    code: 'AUTHENTICATION',
  });
  let reads = 0;
  await assertRejects({
    given: 'unavailable identity for invitation metadata',
    should: 'refuse before producer I/O',
    actual: () =>
      authorizeRequest({
        identity: { state: 'unavailable', principal: { kind: 'anonymous' } },
        capability: 'channel.invitation.read',
        load: async () => {
          reads++;
          return null;
        },
      }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'unavailable identity',
    should: 'perform no metadata lookup',
    actual: reads,
    expected: 0,
  });
});
test('metadata masking does not change successful canonical grants', () => {
  assert({
    given: 'current invited-self and pending sender facts',
    should: 'preserve both authorized metadata reads',
    actual: reads.map((candidate) => requireAuthorization(candidate)),
    expected: [undefined, undefined],
  });
});
