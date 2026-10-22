import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withMediaRound } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

const outcome = (work: Promise<{ state: string }>) =>
  work.then(
    (admitted) => admitted.state,
    (error: { code?: string; message?: string }) =>
      `${error.code ?? 'error'}: ${error.message ?? ''}`,
  );

test('concurrent debater admissions beside a reconciling client are all admitted', async () => {
  await withMediaRound(async (f) => {
    const outcomes: string[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Two pages open the room together; the first then keeps reconciling.
      const host = outcome(
        f.mediaOperations.session(f.roundId, f.host.actorId),
      );
      const guest = outcome(
        f.mediaOperations.session(f.roundId, f.guest.actorId),
      );
      const reconciling = (async () => {
        await host;
        for (let tick = 0; tick < 4; tick += 1)
          await f.mediaOperations.reconcile(f.roundId, f.host.actorId);
      })();
      outcomes.push(await host, await guest);
      await reconciling;
    }
    assert({
      given:
        'two seated debaters admitting at once while one client reconciles, five times',
      should: 'admit every request rather than refusing as unavailable',
      actual: outcomes.filter((value) => value !== 'ready'),
      expected: [],
    });
  });
}, 60_000);
