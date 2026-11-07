import { assert, setupRitewayBun } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { systemClock, systemId } from '@daisy/clock';
import { mkdir } from 'node:fs/promises';
import { createId } from '@paralleldrive/cuid2';
import { createApp } from '../src/server/app';
import { authTestEnv } from '../src/features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../src/features/messaging/beta-policy';
import { recordingReads } from '../src/features/recording/composition';
import { openDownload } from '../src/features/recording/download';
import { requestParticipantRemoval } from '../src/features/recording/removal';
import type { RecordingViewer } from '../src/features/recording/audience';
import type { withRoomRuntime } from './room-runtime.test-support';
import { withDownloadTransport } from './economics-download-transport.test-support';
import { collectDownloadObservation } from './economics-download-report.test-support';

setupRitewayBun();
type Fixture = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];

/** Called only with the owning capture producer's actual ready object, never a
 * fabricated successful output row. Capture execution retains its own attribution. */
export async function observeAc3Downloads(
  f: Fixture,
  input: {
    readonly recordingId: string;
    readonly videoBytes: Uint8Array;
    readonly directory: string;
  },
) {
  const services = requireTestServices(process.env);
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: services.databaseUrl,
      REDIS_URL: services.redisUrl,
      REDIS_NAMESPACE: `t3-${createId()}`,
      LOG_LEVEL: 'silent',
      PREMIUM_BETA_GRANT: 'true',
      BILLING_ECONOMICS_DIRECTORY: input.directory,
    },
    messagingPolicy: betaMessagingPolicy,
    clock: systemClock,
    ids: systemId,
    fetch: async () => {
      throw Error('External transport is outside this download TEST');
    },
  });
  try {
    await withDownloadTransport(async (transport) => {
      const observedApp = {
        ...app,
        database: f.store,
        recordingObjects: transport.objects,
        reporter: { capture: () => undefined },
      };
      const { archive: store, inputs } = recordingReads(observedApp);
      const record = await store.find(input.recordingId);
      if (record?.lifecycle.status !== 'ready' || input.videoBytes.length < 2)
        throw Error('Download requires the actual ready capture output');
      transport.put(record.lifecycle.media.downloadKey, input.videoBytes);
      const bracketStart = await f.store.databaseNow();
      const host: RecordingViewer = { kind: 'account', ...f.host };
      const grants = await f.store.recordingCaptures.readAccountGrants(
        f.host.userId,
      );
      assert({
        given:
          'the actual authorized TEST account and its current persisted grant',
        should:
          'bind download measurements to beta provenance rather than invent a paid subscription',
        actual: grants
          .filter((grant) => grant.entitlement === 'recording_download')
          .map((grant) => grant.source),
        expected: ['beta'],
      });
      const issue = (viewer: RecordingViewer = host) =>
        openDownload(
          { store, inputs, objects: transport.objects },
          { recordingId: record.id, viewer, presentedLinkHashOf: () => null },
        );
      await assertRejects({
        given:
          'a visitor attempting the actual ready Recording download operation',
        should: 'refuse before any object transfer',
        actual: () => issue({ kind: 'visitor' }),
        code: 'NOT_FOUND',
      });
      await f.sql`delete from account_entitlement_grants where user_id=${f.guest.userId} and entitlement='recording_download'`;
      await assertRejects({
        given: 'a seated participant with no download grant',
        should: 'refuse before any signed object transfer',
        actual: () => issue({ kind: 'account', ...f.guest }),
        code: 'NOT_FOUND',
      });
      await issue();
      assert({
        given: 'refused operations and an authorized but unused link',
        should: 'record neither an object request nor a completed download',
        actual: transport.facts(),
        expected: { attempts: 0, completed: 0, bytes: 0, peak: 0, active: 0 },
      });
      const progression = [];
      for (let n = 0; n < 2; n++) {
        await transport.receive(await issue(), input.videoBytes);
        await transport.waitActive(0);
        progression.push(transport.facts());
      }
      assert({
        given: 'two actual authorized complete object reads in sequence',
        should:
          'increase verified volume independently from request high-water',
        actual: progression,
        expected: [1, 2].map((n) => ({
          attempts: n,
          completed: n,
          bytes: n * input.videoBytes.length,
          peak: 1,
          active: 0,
        })),
      });
      const release = transport.hold();
      const overlap = await Promise.all([issue(), issue()]);
      const received = Promise.allSettled(
        overlap.map((url) => transport.receive(url, input.videoBytes)),
      );
      try {
        await transport.waitActive(2);
      } finally {
        release();
      }
      for (const outcome of await received)
        if (outcome.status === 'rejected') throw outcome.reason;
      await transport.waitActive(0);
      const partialRelease = transport.hold();
      try {
        const partial = await fetch(await issue());
        const reader = partial.body!.getReader();
        await reader.read();
        await reader.cancel();
      } finally {
        partialRelease();
      }
      await transport.waitActive(0);
      assert({
        given:
          'overlapping complete transfers followed by a cancelled partial transfer',
        should:
          'retain measured peak two and count only complete hash-verified client receipts',
        actual: transport.facts(),
        expected: {
          attempts: 5,
          completed: 4,
          bytes: 4 * input.videoBytes.length,
          peak: 2,
          active: 0,
        },
      });
      const current = (await store.find(record.id))!;
      await requestParticipantRemoval(
        { store, inputs },
        {
          recordingId: record.id,
          expectedVersion: current.version,
          viewer: host,
          now: app.clock.now(),
        },
      );
      await assertRejects({
        given:
          'a participant removal through the existing production privacy operation',
        should:
          'refuse any new download link without increasing measured volume',
        actual: () => issue(),
        code: 'NOT_FOUND',
      });
      const result = await collectDownloadObservation({
        app: observedApp,
        f,
        transport,
        directory: input.directory,
        bracketStart,
      });
      process.stdout.write(
        JSON.stringify({
          kind: 'BILLING_AC3_RECORDING_DOWNLOAD_TEST',
          scope:
            'actual authorized beta TEST transfer of owned verified output; controlled loopback receiver, not Tigris/vendor or production-monthly evidence',
          ...result,
          progression,
          events: transport.events,
          receipts: transport.receipts,
          observation: transport.facts(),
          configuredTransferLimit: 'unknown',
          signingRateIsNotTransferCapacity: true,
        }) + '\n',
      );
    });
  } finally {
    await app.close();
  }
}
