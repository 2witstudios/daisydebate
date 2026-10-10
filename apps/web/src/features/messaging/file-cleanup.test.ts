import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { Database } from '@daisy/db';
import type { PendingFileAuthorizationFact } from '@daisy/auth/authorization';
import { composeMessagingFileCleanup } from './file-cleanup';
setupRitewayBun();
const ids = ['actor', 'user', 'channel', 'file'].map((part) =>
  part.padEnd(24, 'x'),
);
const scope = { actorId: ids[0]!, userId: ids[1]!, channelId: ids[2]! };
const token = { fileId: ids[3]!, generation: 3 };
const account = { ...scope, member: true, erased: false, revision: 4 };
const fact: PendingFileAuthorizationFact = {
  kind: 'pending_file',
  fileId: token.fileId,
  channelId: scope.channelId,
  ownerActorId: scope.actorId,
  lifecycle: 'quarantined',
  generation: 3,
  expectedGeneration: 3,
  revision: 2,
  channel: {
    channelId: scope.channelId,
    kind: 'dm',
    policyKey: 'social.dm',
    policyRevision: 1,
    revision: 8,
  },
};
test('actual pending cleanup composition uses canonical own-file authority without social grants', async () => {
  let writes = 0;
  let currentFact = fact;
  let currentAccount = account;
  const database: Pick<Database, 'messagingFileCleanup'> = {
    messagingFileCleanup: (authorize) => async (input, expected) => {
      await authorize({ execute: async () => [] } as never, input, {
        fact: { ...currentFact, expectedGeneration: expected.generation },
        accounts: [currentAccount],
      });
      writes += 1;
    },
  };
  const cleanup = composeMessagingFileCleanup({
    database,
    principal: { kind: 'user', userId: scope.userId, actorId: scope.actorId },
  });
  await cleanup(scope, token);
  assert({
    given:
      'an own pending file after grant/block/posting revocation with no age or policy',
    should: 'permit exactly its canonical cleanup',
    actual: writes,
    expected: 1,
  });
  for (const patch of [
    { lifecycle: 'attached' as const },
    { lifecycle: 'deleting' as const },
    { lifecycle: 'deleted' as const },
    { ownerActorId: 'foreign'.padEnd(24, 'x') },
    { generation: 4 },
    { channelId: 'different'.padEnd(24, 'x') },
  ]) {
    currentFact = { ...fact, ...patch };
    await assertRejects({
      given: JSON.stringify(patch),
      should: 'refuse cleanup before an update',
      actual: () => cleanup(scope, token),
      code: 'AUTHORIZATION',
    });
  }
  currentFact = fact;
  currentAccount = { ...account, erased: true, member: false };
  await assertRejects({
    given: 'a tombstoned current owner',
    should: 'refuse its pending cleanup',
    actual: () => cleanup(scope, token),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'all rejected cleanup attempts',
    should: 'leave the update count unchanged',
    actual: writes,
    expected: 1,
  });
});
