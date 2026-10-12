import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createObservationAuthorityOperations } from '../src/observation-authority';
import {
  createWorkloadExecutor,
  workloadDatabase,
} from '../src/workload-executor';
import { RUNTIME_SESSION } from '../src/session-bounds';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import {
  observationBarrier,
  observationBarrierClient,
} from './observation-barrier.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('resource appearance and audience change after an absent-row fence restart the complete real transaction', async () => {
  await withFixture(url, async (f) => {
    const principal = {
        ...(await createAuthorizationSubject(f)),
        sessionId: createId(),
      },
      creator = await createAuthorizationSubject(f),
      id = createId();
    await f.insert('session', {
      id: principal.sessionId,
      user_id: principal.userId,
      token: createId(),
      expires_at: new Date('2099-01-01'),
    });
    const fenced = observationBarrier(),
      continueAfterFence = observationBarrier(),
      currentRead = observationBarrier(),
      continueAfterRead = observationBarrier();
    let transactions = 0,
      roundReads = 0,
      fenceReads = 0;
    const statements: string[] = [];
    const client = new SQL(url, { max: 1, connection: RUNTIME_SESSION });
    const wrapped = observationBarrierClient(
      client,
      async (statement) => {
        statements.push(statement);
        if (
          statement.includes('daisy_observation_authority_fences') &&
          ++fenceReads === 1
        ) {
          fenced.resolve();
          await continueAfterFence.promise;
        }
        if (statement.includes('from "rounds"') && ++roundReads === 2) {
          currentRead.resolve();
          await continueAfterRead.promise;
        }
      },
      () => transactions++,
    );
    const raw = drizzle({ client: wrapped }),
      scoped = workloadDatabase(
        raw,
        createWorkloadExecutor({ admission: 1 }),
        'admission',
      );
    const decisions: string[] = [];
    const operations = createObservationAuthorityOperations(
      { admission: scoped, renewal: scoped },
      (context) => {
        const fact = context.resourceFact;
        if (fact.kind !== 'round') return { status: 'denied' };
        decisions.push(fact.visibility);
        return fact.visibility === 'public'
          ? {
              status: 'allowed',
              partition: { kind: 'shared', policyKey: 'round-clock-v1' },
              dependencies: [],
              eligibleUntil: null,
              overlay: null,
            }
          : { status: 'denied' };
      },
    );
    const request = operations.admitObservationAuthorityBatch([
      {
        principal,
        resource: { kind: 'round', id },
        window: { after: null, limit: 1 },
      },
    ]);
    try {
      await Promise.race([
        fenced.promise,
        request.then((result) => {
          throw new Error(
            `Authority completed before fence barrier: ${JSON.stringify({ result, roundReads, fenceReads, transactions, statements })}`,
          );
        }),
      ]);
      await f.round({
        id,
        created_by_actor_id: creator.actorId,
        visibility: 'public',
      });
      continueAfterFence.resolve();
      await Promise.race([
        currentRead.promise,
        request.then(() => {
          throw new Error('Authority completed before current-fact barrier');
        }),
      ]);
      await f.sql`update rounds set visibility='private',version=version+1 where id=${id}`;
      continueAfterRead.resolve();
      const result = await request;
      assert({
        given:
          'real PostgreSQL target appears public after missing fence, then becomes private after facts were captured',
        should:
          'roll back/retry from ordered account discovery and evaluate only the actually fenced current private facts',
        actual: { result, transactions, decisions },
        expected: {
          result: [{ status: 'denied' }],
          transactions: 2,
          decisions: ['private'],
        },
      });
    } finally {
      continueAfterFence.resolve();
      continueAfterRead.resolve();
      await request;
      await client.close();
    }
  });
});
