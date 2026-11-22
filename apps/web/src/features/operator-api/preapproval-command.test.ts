import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { runPreapprovalCommand } from './preapproval-command';

setupRitewayBun();
test('preapproval restarts at most three fresh attempts and checks liveness before each', async () => {
  let attempts = 0,
    live = 0;
  const answer = await runPreapprovalCommand(
    {
      preapprovalCommand: async () => {
        attempts += 1;
        return { kind: 'restart' };
      },
    },
    {
      command: {
        v: 1,
        commandId: createId(),
        adminAuditHead: 'a'.repeat(64),
        operation: 'add',
        email: 'retry@example.test',
        invite: false,
      },
      serviceId: 'daisy-admin',
      operatorRef: 'o'.repeat(24),
      requestDigest: 'a'.repeat(64),
      nextId: createId,
      live: () => {
        live += 1;
        return true;
      },
    },
  ).then(
    () => 'accepted',
    (error: { code?: string }) => error.code,
  );
  assert({
    given: 'changed account discovery on every completed attempt',
    should: 'check live and open exactly three fresh attempts before conflict',
    actual: [answer, attempts, live],
    expected: ['CONFLICT', 3, 3],
  });
});

test('an expired preapproval attempt stops before opening its first or next transaction', async () => {
  const outcomes = [];
  for (const expireAt of [1, 2]) {
    let attempts = 0,
      checks = 0;
    const result = await runPreapprovalCommand(
      {
        preapprovalCommand: async () => {
          attempts += 1;
          return { kind: 'restart' };
        },
      },
      {
        command: {
          v: 1,
          commandId: createId(),
          adminAuditHead: 'a'.repeat(64),
          operation: 'add',
          email: 'live@example.test',
          invite: false,
        },
        serviceId: 'daisy-admin',
        operatorRef: 'o'.repeat(24),
        requestDigest: 'a'.repeat(64),
        nextId: createId,
        live: () => ++checks < expireAt,
      },
    ).then(
      () => 'accepted',
      (error: { code?: string }) => error.code,
    );
    outcomes.push([result, attempts, checks]);
  }
  assert({
    given:
      'a request expired before entry or between account-discovery attempts',
    should: 'reject before opening any expired transaction',
    actual: outcomes,
    expected: [
      ['CONFLICT', 0, 1],
      ['CONFLICT', 1, 2],
    ],
  });
});
