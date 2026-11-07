import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  withEvidenceIngressCohort,
  type EvidenceIngressFixture,
} from './necessary-evidence-ingress.test-support';
import {
  readyRecognition,
  recognitionTestOptions,
} from './transcription-recovery.test-support';
import { spawnRecognitionProcess } from './transcription-recovery-process.test-support';
import { spawnRetirementProcess } from './necessary-evidence-retirement-process.test-support';
import { createNecessaryEvidenceIngress } from '../src/features/media-capture/necessary-evidence-ingress';
setupRitewayBun();
requireTestServices(process.env);
test('missing-source recovery passes a full independently revoked prefix to reach later usable original work', async () => {
  const fixtures: EvidenceIngressFixture[] = [];
  await withEvidenceIngressCohort(async (create) => {
    for (let index = 0; index < 9; index += 1) {
      const raw = await create();
      // One genuinely persistent independent authority owns every original key in this workload.
      const fixture = { ...raw, custody: fixtures[0]?.custody ?? raw.custody };
      fixtures.push(fixture);
      await readyRecognition(fixture);
      await fixture.f
        .sql`delete from transcription_recovery_contexts where round_id=${fixture.roundId}`;
    }
    const fixture = fixtures.at(-1)!;
    const work = fixture.f.store.createTranscriptionRecovery(
      recognitionTestOptions,
    );
    {
      await fixture.f
        .sql`update transcription_recovery_enrollment_progress set after_at=null,after_round_id=null,until_at=null,until_round_id=null,next_scan_at=clock_timestamp()-interval '1 millisecond' where singleton`;
      const ready = join(fixture.dir, 'scan-committed'),
        release = join(fixture.dir, 'never-release');
      const interrupted = spawnRecognitionProcess({
        operation: 'scan',
        ready,
        release,
      });
      let first: { roundId: string; evidenceId: string }[];
      try {
        const until = performance.now() + 5000;
        while (!existsSync(ready)) {
          if (interrupted.exitCode !== null || performance.now() > until)
            throw new Error('Missing committed scan barrier');
          await Bun.sleep(5);
        }
        first = await Bun.file(ready).json();
        const [offers] = await fixture.f
          .sql`select count(*)::integer as count from transcription_recovery_enrollment_offers where evidence_id=any(${fixture.f.sql.array(
          first.map((unit) => unit.evidenceId),
          'text',
        )}::text[])`;
        if (offers!.count !== first.length)
          throw new Error(
            'Per-unit offers were not committed before the process barrier',
          );
        interrupted.kill('SIGKILL');
        await interrupted.exited;
      } finally {
        if (interrupted.exitCode === null) {
          interrupted.kill('SIGKILL');
          await interrupted.exited;
        }
      }
      // These keys are revoked AFTER traversal visited them, while old PG payload rows remain.
      for (const blocked of fixtures.slice(0, 8)) {
        const [row] = await blocked.f
          .sql`select authority_id,binding_digest from necessary_evidence where id=${blocked.body.evidenceId}`;
        const revoked = await fixture.custody.revoke({
          authorityId: row!.authority_id,
          evidenceId: blocked.body.evidenceId,
          bindingDigest: row!.binding_digest,
        });
        if (revoked.kind !== 'revoked')
          throw new Error('Expected independent durable key revocation');
      }
      const authorityReady = join(
        fixtures[0]!.dir,
        'enrollment-authority-locked',
      );
      const authorityRelease = join(
        fixtures[0]!.dir,
        'enrollment-authority-release',
      );
      const holder = spawnRetirementProcess({
        dir: fixtures[0]!.dir,
        operation: 'hold-authority',
        barriers: [
          {
            at: 'authority-locked',
            ready: authorityReady,
            release: authorityRelease,
          },
        ],
      });
      let uncertain: unknown;
      try {
        const until = performance.now() + 5000;
        while (!existsSync(authorityReady)) {
          if (holder.exitCode !== null || performance.now() > until)
            throw new Error('Missing real authority lock');
          await Bun.sleep(5);
        }
        uncertain = await createNecessaryEvidenceIngress({
          store: fixtures[0]!.capture,
          custody: fixture.custody,
        }).restore(first[0]!);
        await writeFile(authorityRelease, 'release');
        const [, , code] = await Promise.all([
          new Response(holder.stdout).text(),
          new Response(holder.stderr).text(),
          holder.exited,
        ]);
        if (code !== 0) throw new Error('Authority lock process failed');
      } finally {
        if (holder.exitCode === null) {
          holder.kill('SIGKILL');
          await holder.exited;
        }
      }
      const [stillOpaque] = await fixture.f
        .sql`select state,ciphertext is not null as payload from necessary_evidence where id=${first[0]!.evidenceId}`;
      const denials = await Promise.all(
        first.map(async (unit) => {
          const owner = fixtures.find((item) => item.roundId === unit.roundId)!;
          return createNecessaryEvidenceIngress({
            store: owner.capture,
            custody: fixture.custody,
          }).restore(unit);
        }),
      );
      // Add a real later Round while the old pass is open; it must not extend that captured boundary.
      {
        const addedRaw = await create();
        const added = { ...addedRaw, custody: fixture.custody };
        await readyRecognition(added);
        await added.f
          .sql`delete from transcription_recovery_contexts where round_id=${added.roundId}`;
        // Real pacing wait, never a receipt/detection latency claim.
        await Bun.sleep(1100);
        const fresh = spawnRecognitionProcess({ operation: 'scan' });
        const [out, , code] = await Promise.all([
          new Response(fresh.stdout).text(),
          new Response(fresh.stderr).text(),
          fresh.exited,
        ]);
        if (code !== 0) throw new Error('Fresh scan process failed');
        const second = JSON.parse(out) as {
          roundId: string;
          evidenceId: string;
        }[];
        await Bun.sleep(1100);
        const third = await work.missing();
        const target = fixtures.at(-1)!;
        const reached = [...second, ...third].some(
          (unit) => unit.evidenceId === target.body.evidenceId,
        );
        const restored = await createNecessaryEvidenceIngress({
          store: target.capture,
          custody: fixture.custody,
        }).restore({
          roundId: target.roundId,
          evidenceId: target.body.evidenceId,
        });
        assert({
          given:
            'an actual SIGKILL after the eight-unit page commit, later key revocation, a fresh scanner and an arriving Round beyond the captured pass boundary',
          should:
            'advance bounded recovery discovery across repeated scans without changing original authority or leaving later usable work parked',
          actual: {
            firstCount: first.length,
            runtimeOwners: new Set(
              [...fixtures, added].map((item) => item.f.store),
            ).size,
            queryOwners: new Set([...fixtures, added].map((item) => item.f.sql))
              .size,
            uncertain,
            stillOpaque,
            allRefused: denials.every((reply) => reply.kind === 'refused'),
            reached,
            usable: restored.kind,
            boundedTail: second.map((unit) => unit.evidenceId),
            revisited: third.some(
              (unit) => unit.evidenceId === fixtures[0]!.body.evidenceId,
            ),
          },
          expected: {
            firstCount: 8,
            runtimeOwners: 1,
            queryOwners: 1,
            uncertain: { kind: 'refused', reason: 'unavailable' },
            stillOpaque: { state: 'retained', payload: true },
            allRefused: true,
            reached: true,
            usable: 'restored',
            boundedTail: [target.body.evidenceId],
            revisited: true,
          },
        });
      }
    }
  });
}, 20000);
