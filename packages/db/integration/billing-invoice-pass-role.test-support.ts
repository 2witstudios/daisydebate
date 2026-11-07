import {
  cleanupWork,
  type CleanupWork,
  type CleanupState,
} from '@daisy/protocol/billing';
import type { cleanupCandidate } from './billing-cleanup-candidate.test-support';
export async function claimTarget(
  matrix: ReturnType<typeof cleanupCandidate>,
  lane: 'invoices' | 'observations',
  id: string,
  short: boolean | number = false,
) {
  for (let n = 0; n < 20; n++) {
    const current = claimedScan(await matrix.claim(short));
    if (matchesTarget(current.work, lane, id)) return current;
    await advanceOther(matrix, current, lane, id);
  }
  throw Error('Bounded role fixture target unavailable');
}
export function passOf(work: CleanupWork) {
  if (
    work.kind !== 'scan' ||
    work.scan.kind !== 'selected' ||
    work.scan.detail.kind !== 'invoice-payments' ||
    !work.scan.detail.pass
  )
    throw Error('Missing exact invoice pass');
  return work.scan.detail.pass;
}

function claimedScan(state: CleanupState) {
  const work = cleanupWork(state);
  if (state.kind !== 'scanning' || !state.claim || work?.kind !== 'scan')
    throw Error('Missing current role scan');
  return { state, work, claimId: state.claim.id };
}
function matchesTarget(
  work: Extract<CleanupWork, { kind: 'scan' }>,
  lane: string,
  id: string,
) {
  return (
    work.lane === lane && work.scan.kind === 'selected' && work.scan.id === id
  );
}
async function advanceOther(
  matrix: ReturnType<typeof cleanupCandidate>,
  current: ReturnType<typeof claimedScan>,
  lane: string,
  id: string,
) {
  const { work, claimId } = current;
  if (work.scan.kind === 'page') {
    const ids =
      work.lane === 'observations'
        ? await matrix.observationIds()
        : work.lane === 'invoices' && lane === 'invoices'
          ? [id]
          : [];
    return matrix.apply({ kind: 'page', claimId, work, ids, more: false });
  }
  if (work.lane === 'observations' && work.scan.kind === 'selected')
    return matrix.apply({
      kind: 'retained',
      claimId,
      work,
      observation: await matrix.readObservation(work.scan.id),
    });
  throw Error('Unexpected role fixture work');
}
