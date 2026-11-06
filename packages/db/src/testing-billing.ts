import type { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import type { createDatabase } from './index';
import type { CleanupWork } from '@daisy/protocol/billing';
type Cleanup = ReturnType<ReturnType<typeof createDatabase>['billingCleanup']>;
type ScanWork = Extract<CleanupWork, { kind: 'scan' }>;

/** Controlled vendor absence/deletion responses through real typed cleanup, never Stripe lifecycle proof. */
export async function completeControlledStripeCleanup(input: {
  readonly owner: SQL;
  readonly database: Pick<
    ReturnType<typeof createDatabase>,
    'billingCleanup' | 'renewServiceInstance'
  >;
  readonly userId: string;
  readonly instanceId: string;
}) {
  requireTestServices(process.env);
  const { owner, database, userId, instanceId } = input;
  const [job] =
    await owner`select id from privacy_jobs where subject_ref=${userId} and vendor='stripe' and status='pending'`;
  if (!job) throw Error('Missing controlled pending Stripe cleanup');
  const cleanup = database.billingCleanup(instanceId);
  for (let step = 0; step < 20; step++) {
    await owner`select pg_sleep(greatest(0,extract(epoch from retry_at-clock_timestamp()))+.01) from privacy_jobs where id=${job.id}`;
    await database.renewServiceInstance({ instanceId, role: 'web' });
    const claim = await cleanup.claim(job.id);
    if (
      claim.kind !== 'claimed' ||
      claim.state.kind === 'acknowledged' ||
      !claim.state.claim
    )
      throw Error('Controlled cleanup claim refused');
    if (claim.facts.effects.owedFinancialEffects)
      throw Error('Fixture cannot acknowledge owed observation evidence');
    const claimId = claim.state.claim.id,
      work = claim.work;
    if (work.kind === 'delete') {
      const result = await cleanup.record(job.id, {
        kind: 'deleted',
        claimId,
        work,
      });
      if (result !== 'complete')
        throw Error('Controlled deletion confirmation refused');
      return;
    }
    if (work.kind === 'invoice-identity')
      throw Error('Fixture cannot acknowledge unresolved invoice routing');
    await controlledScan(cleanup, job.id, claimId, work);
  }
  throw Error('Controlled cleanup exceeded its bounded fixture steps');
}

async function controlledScan(
  cleanup: Cleanup,
  jobId: string,
  claimId: string,
  work: ScanWork,
) {
  if (work.scan.kind === 'page')
    return controlledPage(cleanup, jobId, claimId, work);
  if (work.scan.kind !== 'selected')
    throw Error('Controlled selected resource missing');
  if (work.lane === 'observations') {
    await cleanup.retainObservation(jobId, claimId, work);
    return;
  }
  const resource = await cleanup.resources(jobId, claimId, work);
  if (
    resource.kind !== 'refund' ||
    resource.action.state.kind !== 'known' ||
    resource.action.state.status !== 'succeeded'
  )
    throw Error('Fixture cannot resolve an unsettled money obligation');
  await cleanup.record(jobId, { kind: 'resolved', claimId, work });
}
async function controlledPage(
  cleanup: Cleanup,
  jobId: string,
  claimId: string,
  work: ScanWork,
) {
  if (work.scan.kind !== 'page') throw Error('Controlled page phase missing');
  if (work.lane === 'invoices') {
    await cleanup.retainInvoicePage(jobId, claimId, work, {
      reads: [],
      more: false,
    });
    return;
  }
  {
    if (work.lane === 'purchases' || work.lane === 'refunds') {
      const page = await cleanup.resources(jobId, claimId, work);
      if (page.kind !== 'page') throw Error('Controlled resource page refused');
      await cleanup.record(jobId, {
        kind: 'page',
        claimId,
        work,
        ids: page.ids,
        more: page.more,
      });
    } else if (work.lane === 'observations') {
      const page = await cleanup.observations(
        jobId,
        claimId,
        work,
        work.scan.afterId,
      );
      if (page.kind !== 'observations')
        throw Error('Controlled observation page refused');
      await cleanup.record(jobId, {
        kind: 'page',
        claimId,
        work,
        ids: page.observations.map((row) => row.id),
        more: page.more,
      });
    } else {
      await cleanup.record(jobId, {
        kind: 'page',
        claimId,
        work,
        ids: [],
        more: false,
      });
    }
    return;
  }
}
