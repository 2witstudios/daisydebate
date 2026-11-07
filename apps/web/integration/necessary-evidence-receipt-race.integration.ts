import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withEvidenceIngress } from './necessary-evidence-ingress.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);

test('a private read queued behind actual payload adoption accepts its post-wait receipt state', async () => {
  await withEvidenceIngress(async ({ f, capture, custody, body }) => {
    const sealed = Promise.withResolvers<void>(),
      resume = Promise.withResolvers<void>();
    const ingress = createNecessaryEvidenceIngress({
      store: capture,
      custody: {
        ...custody,
        seal: async (...args) => {
          const reply = await custody.seal(...args);
          sealed.resolve();
          await resume.promise;
          return reply;
        },
      },
    });
    const receiving = ingress.receive(body);
    await sealed.promise;
    const locked = Promise.withResolvers<number>(),
      release = Promise.withResolvers<void>();
    const holder = f.sql.begin(async (tx) => {
      await tx`select id from necessary_evidence where id=${body.evidenceId} for update`;
      const [row] = await tx`select pg_backend_pid() as pid`;
      locked.resolve(Number(row!.pid));
      await release.promise;
    });
    const blockers = async (pid: number) => {
      const until = performance.now() + 1000;
      for (;;) {
        const rows =
          await f.sql`select pid from pg_stat_activity where datname=current_database() and ${pid}=any(pg_blocking_pids(pid))`;
        if (rows.length)
          return rows.map((row: { pid: number | string }) => Number(row.pid));
        if (performance.now() >= until)
          throw new Error('Expected real lock dependency missing');
        await Bun.sleep(5);
      }
    };
    let reading: Promise<string> | undefined;
    try {
      const holderPid = await locked.promise;
      resume.resolve();
      const adopterPid = (await blockers(holderPid))[0]!;
      reading = capture
        .loadCaptureEvidencePayload({
          roundId: body.roundId,
          evidenceId: body.evidenceId,
        })
        .then(
          (reply) => reply.kind,
          (error) => (isAppError(error) ? error.code : 'unknown'),
        );
      const readers = await blockers(adopterPid);
      release.resolve();
      await holder;
      const [receipt, read] = await Promise.all([receiving, reading]);
      assert({
        given:
          'actual adoption holding Round while waiting on the original intent, then a private reader that sampled acquiring and queued behind that adopter',
        should:
          'observe the committed retained payload after the wait without mistaking its permitted state transition for changed original authority',
        actual: { queued: readers.length > 0, receipt: receipt.kind, read },
        expected: { queued: true, receipt: 'received', read: 'received' },
      });
    } finally {
      resume.resolve();
      release.resolve();
      await Promise.allSettled([
        holder,
        receiving,
        ...(reading ? [reading] : []),
      ]);
    }
  });
});
