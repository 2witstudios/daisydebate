import type { SQL, TransactionSQL, ReservedSQL } from 'bun';
import { sqlStateOf } from './constraint-helpers';

/** A bounded external member lock makes the guard cross its live claim deadline after entry. */
export async function classifyAcrossMemberWait(input: {
  readonly sql: SQL;
  readonly tx: TransactionSQL;
  readonly paymentId: string;
  readonly invoiceId: string;
  readonly state: unknown;
  readonly expiresAt: string;
}) {
  const holder = await input.sql.reserve();
  let release: Promise<unknown> | undefined;
  let result: Promise<string> | undefined;
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await holder`begin`;
    active = true;
    await holder`set local role daisy_web`;
    // Acquisition failure is immediate and observed; never leave an entered promise hanging.
    await holder`select id from billing_payment_observations where id=${input.paymentId} for update nowait`;
    const [parent] = await input.tx`select pg_backend_pid() as pid`;
    const query = input.tx`update billing_payment_observations set state=${JSON.stringify(input.state)}::text::jsonb,observed_at=date_trunc('milliseconds',clock_timestamp()) where id=${input.invoiceId}`;
    timer = setTimeout(() => query.cancel(), 2500);
    result = sqlStateOf(() => query);
    release = Bun.sleep(1000)
      .then(async () => {
        await holder`rollback`;
        active = false;
      })
      .catch((error) => {
        query.cancel();
        throw error;
      });
    const wait = observeWait(holder, parent!.pid, input.expiresAt);
    const outcomes = await Promise.allSettled([result, release, wait]);
    for (const outcome of outcomes)
      if (outcome.status === 'rejected') throw outcome.reason;
    const code = outcomes[0]!,
      observed = outcomes[2]!;
    if (code.status !== 'fulfilled' || observed.status !== 'fulfilled')
      throw Error('Wait fixture failed');
    return { code: code.value, waitObservedWhileLive: observed.value };
  } finally {
    if (timer) clearTimeout(timer);
    if (active) await holder`rollback`;
    await Promise.allSettled([
      ...(result ? [result] : []),
      ...(release ? [release] : []),
    ]);
    holder.release();
  }
}
async function observeWait(
  holder: ReservedSQL,
  pid: number,
  expiresAt: string,
) {
  for (let n = 0; n < 50; n++) {
    const [row] =
      await holder`select cardinality(pg_blocking_pids(${pid}))>0 as waiting,clock_timestamp() as at`;
    if (row?.waiting) return row.at.getTime() < Date.parse(expiresAt);
    await Bun.sleep(10);
  }
  return false;
}
