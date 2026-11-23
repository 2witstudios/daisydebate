import { scopeReservedTransaction } from './tenant-scope';
import type { ReservedSQL, SQL } from 'bun';
import { afterMs, type Waits } from '@daisy/clock';
import { createAppError, isAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  runTransactionLifecycle,
  type TransactionLifecycle,
  type TransactionMetadata,
} from './transaction-lifecycle';
import { transactionSettlement } from './transaction-settlement';
import { synchronizedTransactionClient } from './transaction-client';
import { transactionContext } from './transaction-context';
import type { Lane } from './workload';
import {
  recoverTransactionBackend,
  type OwnedBackend,
} from './transaction-watchdog';
import type { Tx } from './tx';
import { z } from 'zod';
import { query } from './raw-rows';

const TRANSACTION_MS = 3000;
/** A writer's work connection plus the watchdog that can terminate it. */
const WRITER_CONNECTIONS = 2;
type TransactionReceipt = Omit<TransactionMetadata, 'writer'> & {
  readonly writer: {
    readonly pid: number;
    readonly backendStart: string | null;
  };
};
type TransactionOptions = {
  readonly lifecycle?: TransactionLifecycle;
  readonly executionMs?: number;
};
type TransactionWork<T> = (
  tx: Tx,
  signal: AbortSignal,
  receipt: TransactionReceipt,
) => Promise<T>;
export type BoundedTransaction = <T>(
  run: TransactionWork<T>,
  options?: TransactionOptions,
) => Promise<T>;

class TransactionAttempt {
  private readonly controller = new AbortController();
  private readonly expired = createAppError(
    'INFRASTRUCTURE',
    'Bounded transaction budget exceeded',
  );
  private readonly deadline: number;
  private watchdog: ReservedSQL | undefined;
  private work: ReservedSQL | undefined;
  private backend: OwnedBackend | undefined;
  private writerBeginIssued = false;
  private commitState: 'not-issued' | 'issued' | 'rolled-back' = 'not-issued';
  private scopeClosed = false;
  private readonly disposed = createAppError(
    'INVARIANT',
    'Transaction callback lifetime has ended',
  );
  private destroyed = false;
  private controlRecovered = true;
  private controlInUse = false;
  private metadata: TransactionMetadata | undefined;
  private lifecycleOpened = false;
  private lifecycleClosed = false;

  constructor(
    /** The lane's own pool, lent while this writer holds its two slots. */
    private readonly client: SQL,
    /** The admitted lane client a later recovery reserves through. */
    private readonly laneClient: SQL,
    private readonly waits: Waits,
    private readonly executionMs: number,
    private readonly lifecycle: TransactionLifecycle | undefined,
  ) {
    this.deadline = waits.nowMs() + executionMs;
  }

  private now() {
    return this.waits.nowMs();
  }

  private checkBudget() {
    this.controller.signal.throwIfAborted();
    if (this.now() >= this.deadline) throw this.expired;
  }

  private readonly refuseControl = (message: string): never => {
    const error = createAppError('INVARIANT', message);
    this.controller.abort(error);
    throw error;
  };

  private readonly checkLifetime = () => {
    if (this.scopeClosed) throw this.disposed;
    this.controller.signal.throwIfAborted();
    this.checkBudget();
  };

  private async runWork<T>(run: TransactionWork<T>): Promise<T> {
    // No writer can hold a lock without its separately owned control connection.
    const options = { signal: this.controller.signal };
    this.watchdog = await this.client.reserve(options);
    this.checkBudget();
    const writer = await this.client.reserve(options);
    this.work = writer;
    this.checkBudget();
    const [identity] = await query(
      writer`select pg_backend_pid() as pid,
      backend_start::text as started,
      to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "receivedAt"
      from pg_stat_activity where pid=pg_backend_pid()`,
      z.object({
        pid: z.int().positive(),
        started: z.string().nullable(),
        receivedAt: z.string(),
      }),
    );
    if (!identity)
      throw createAppError('INFRASTRUCTURE', 'Transaction backend unavailable');
    const { pid, started, receivedAt } = identity;
    // PostgreSQL can hide backend_start after SET ROLE. Such a writer can
    // commit, but a PID alone cannot authorize a lifecycle or prove recovery.
    if (started !== null) {
      this.backend = { pid, started };
      this.metadata = Object.freeze({
        receivedAt,
        writer: Object.freeze({ pid, backendStart: started }),
      });
    }
    const receipt: TransactionReceipt =
      this.metadata ??
      Object.freeze({
        receivedAt,
        writer: Object.freeze({ pid, backendStart: null }),
      });
    await this.runLifecycle('open');
    this.lifecycleOpened = this.lifecycle !== undefined;
    this.checkBudget();
    this.writerBeginIssued = true;
    await this.work`begin isolation level read committed`;
    const backstop = String(Math.min(2000, this.executionMs));
    await this.work`select
      set_config('statement_timeout', ${backstop}, true),
      set_config('lock_timeout', ${backstop}, true),
      set_config('idle_in_transaction_session_timeout', ${backstop}, true),
      set_config('standard_conforming_strings', 'on', true)`;
    this.checkBudget();
    const database = drizzle({
      client: synchronizedTransactionClient(
        this.work,
        this.checkLifetime,
        this.refuseControl,
      ),
    });
    const result = await run(
      transactionContext(
        database,
        this.checkLifetime,
        this.refuseControl,
        async (scope) => {
          this.checkLifetime();
          // Tenant addressing is adapter-owned. Arbitrary callback configuration
          // still passes through the unchanged rejecting statement guard.
          await scopeReservedTransaction(writer, scope);
          this.checkLifetime();
        },
      ),
      this.controller.signal,
      receipt,
    );
    this.scopeClosed = true;
    this.checkBudget();
    this.commitState = 'issued';
    const completion = await this.work<{ command: string }>`commit`;
    if (completion.command !== 'COMMIT') {
      if (completion.command === 'ROLLBACK') this.commitState = 'rolled-back';
      throw createAppError(
        'INFRASTRUCTURE',
        'Bounded transaction did not commit',
      );
    }
    await this.runLifecycle('committed');
    this.lifecycleClosed = true;
    this.checkBudget();
    return result;
  }

  private async runLifecycle(
    outcome: 'open' | 'committed' | 'aborted',
    deadline = this.deadline,
  ) {
    const { lifecycle, watchdog, metadata } = this;
    if (!lifecycle) return;
    if (!watchdog || !metadata)
      throw createAppError('INVARIANT', 'Transaction lifecycle has no backend');
    this.controlInUse = true;
    await runTransactionLifecycle({
      control: watchdog,
      waits: this.waits,
      deadline,
      refuse: this.refuseControl,
      run: (tx) =>
        outcome === 'open'
          ? lifecycle.open(tx, metadata)
          : lifecycle.close(tx, metadata, outcome),
    });
    this.controlInUse = false;
  }

  private async recover(error: unknown): Promise<never> {
    const recoveryDeadline = this.now() + 1000;
    this.controller.abort(error);
    const writer = this.work;
    this.destroyed = writer !== undefined;
    // With a hidden backend start only the original writer's command receipt
    // can prove a rollback. A COMMIT in flight rules out that proof.
    const rolledBack =
      this.commitState === 'rolled-back' ||
      (writer !== undefined &&
        this.writerBeginIssued &&
        this.backend === undefined &&
        this.commitState === 'not-issued' &&
        (await this.rollbackWriter(writer, recoveryDeadline)));
    // Never release an uncertain writer for another logical attempt on the same backend.
    void writer?.close({ timeout: 0 }).catch(() => undefined);
    const absent =
      !rolledBack && (await this.confirmRollback(recoveryDeadline));
    const rollbackConfirmed = rolledBack || absent;
    this.controlRecovered = rollbackConfirmed;
    await this.closeAbortedLifecycle(rollbackConfirmed, recoveryDeadline);
    if (
      !rollbackConfirmed ||
      this.commitState === 'issued' ||
      (this.lifecycleOpened && !this.lifecycleClosed)
    )
      throw createAppError(
        'INFRASTRUCTURE',
        'Bounded transaction recovery pending',
        {
          recovery: 'pending',
          cause: error,
          settlement: transactionSettlement({
            client: this.laneClient,
            backend: this.backend,
            absent,
            waits: this.waits,
          }),
        },
      );
    if (error === this.expired)
      throw createAppError('INFRASTRUCTURE', this.expired.message, {
        recovery: 'rolled-back',
      });
    if (isAppError(error)) throw error;
    throw createAppError('INFRASTRUCTURE', 'Bounded transaction failed', error);
  }

  private async rollbackWriter(writer: ReservedSQL, deadline: number) {
    const remaining = deadline - this.now();
    if (remaining <= 0) return false;
    let cancel = () => {};
    const rollback = async () => {
      const receipt = await writer<{ command: string }>`rollback`;
      return receipt.command === 'ROLLBACK';
    };
    try {
      return await Promise.race([
        rollback(),
        new Promise<false>((resolve) => {
          cancel = afterMs(this.waits, remaining, () => resolve(false));
        }),
      ]);
    } catch {
      return false;
    } finally {
      cancel();
    }
  }

  private async closeAbortedLifecycle(
    rollbackConfirmed: boolean,
    recoveryDeadline: number,
  ) {
    if (
      rollbackConfirmed &&
      this.lifecycleOpened &&
      this.commitState !== 'issued'
    ) {
      try {
        await this.runLifecycle('aborted', recoveryDeadline);
        this.lifecycleClosed = true;
      } catch {
        this.controlRecovered = false;
      }
    }
  }

  private confirmRollback(deadline: number): Promise<boolean> {
    if (this.controlInUse) {
      void this.watchdog?.close({ timeout: 0 }).catch(() => undefined);
      return Promise.resolve(false);
    }
    if (!this.writerBeginIssued) return Promise.resolve(true);
    const remaining = deadline - this.now();
    if (
      this.backend === undefined ||
      this.watchdog === undefined ||
      remaining <= 0
    )
      return Promise.resolve(false);
    return recoverTransactionBackend(
      this.waits,
      this.watchdog,
      this.backend,
      remaining,
    );
  }

  async run<T>(work: TransactionWork<T>): Promise<T> {
    let cancel = () => {};
    const budget = new Promise<never>((_, reject) => {
      cancel = afterMs(this.waits, this.deadline - this.now(), () => {
        this.controller.abort(this.expired);
        reject(this.expired);
      });
    });
    try {
      return await Promise.race([this.runWork(work), budget]);
    } catch (error) {
      return await this.recover(error);
    } finally {
      this.scopeClosed = true;
      this.controller.abort(this.disposed);
      cancel();
      // A destroyed connection returns via Bun's onClose, never as a reusable socket.
      if (!this.destroyed) this.work?.release();
      if (this.controlRecovered) this.watchdog?.release();
      else void this.watchdog?.close({ timeout: 0 }).catch(() => undefined);
    }
  }
}

/**
 * A writer on one lane (the competitive lane, ADR 0088): it is admitted for
 * two connections, its work and its watchdog, and holds both until the
 * attempt settles, recovery included.
 */
export function createBoundedTransaction({
  lane,
  waits,
  executionMs = TRANSACTION_MS,
}: {
  readonly lane: Pick<Lane, 'client' | 'withSlots'>;
  /** The time every budget is measured on, injected by the composition root (R4.7). */
  readonly waits: Waits;
  /** Execution slice including reservations/setup/commit; recovery may need another1000ms. */
  readonly executionMs?: number;
}): BoundedTransaction {
  if (
    !Number.isSafeInteger(executionMs) ||
    executionMs < 1 ||
    executionMs > TRANSACTION_MS
  )
    throw createAppError('INVARIANT', 'Invalid transaction execution budget');
  return async <T>(
    run: TransactionWork<T>,
    options?: TransactionOptions,
  ): Promise<T> => {
    const slice = options?.executionMs ?? executionMs;
    if (!Number.isSafeInteger(slice) || slice < 1 || slice > executionMs)
      throw createAppError('INVARIANT', 'Invalid transaction execution budget');
    return lane.withSlots(WRITER_CONNECTIONS, (pool) =>
      new TransactionAttempt(
        pool,
        lane.client,
        waits,
        slice,
        options?.lifecycle,
      ).run(run),
    );
  };
}
