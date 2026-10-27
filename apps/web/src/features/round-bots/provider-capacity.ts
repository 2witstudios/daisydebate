import { createAppError } from '@daisy/errors';

type WorkClass = 'judging' | 'realtime' | 'coaching';
type Active = Readonly<Record<WorkClass, number>>;

/** Coaching may use at most half the budget and must leave a competitive slot. */
export function providerAdmission(input: {
  readonly limit: number;
  readonly active: Active;
  readonly workClass: WorkClass;
}) {
  const { limit, active, workClass } = input;
  const total = active.judging + active.realtime + active.coaching;
  if (total >= limit) return false;
  return (
    workClass !== 'coaching' ||
    (total < limit - 1 && active.coaching < Math.floor(limit / 2))
  );
}

/** Process-local bounded admission; no waiting queue or early cancellation release. */
export function createProviderCapacity(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw createAppError('VALIDATION');
  const active: Record<WorkClass, number> = {
    judging: 0,
    realtime: 0,
    coaching: 0,
  };
  const reserve = (workClass: WorkClass) => {
    if (!providerAdmission({ limit, active, workClass })) return null;
    active[workClass] += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active[workClass] -= 1;
    };
  };
  const withProvider = async <T>(
    signal: AbortSignal,
    work: () => Promise<T>,
    workClass: WorkClass = 'realtime',
  ): Promise<T> => {
    const release = signal.aborted ? null : reserve(workClass);
    if (!release)
      throw createAppError('CONFLICT', 'Provider capacity unavailable');
    try {
      return await work();
    } finally {
      release();
    }
  };
  return Object.assign(withProvider, { reserve });
}
