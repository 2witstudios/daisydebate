import type { ReservedSQL, SQL } from 'bun';
import { createAppError, isAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  runTransactionLifecycle,
  type TransactionLifecycle,
  type TransactionMetadata,
} from './transaction-lifecycle';
import { transactionSettlement } from './transaction-settlement';
import { synchronizedTransactionClient } from './transaction-client';
import {
  transactionContext,
  type BoundedTransactionContext,
} from './transaction-context';
import { createTransactionAdmission } from './transaction-admission';
import {
  recoverTransactionBackend,
  type OwnedBackend,
} from './transaction-watchdog';

const TRANSACTION_MS = 3000;
type TransactionReceipt = TransactionMetadata;
type TransactionOptions = {
  readonly lifecycle?: TransactionLifecycle;
  readonly executionMs?: number;
};
type TransactionWork<T> = (
  tx: BoundedTransactionContext,
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
    'Transcript transaction budget exceeded',
  );
  private readonly deadline: number;
  private watchdog: ReservedSQL | undefined;
  private work: ReservedSQL | undefined;
  private backend: OwnedBackend | undefined;
  private committing = false;
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
    private readonly client: SQL,
    private readonly now: () => number,
    private readonly executionMs: number,
    private readonly lifecycle: TransactionLifecycle | undefined,
  ) {
    this.deadline = now() + executionMs;
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

  private async execute<T>(run: TransactionWork<T>): Promise<T> {
    // No writer can hold a lock without its separately owned control connection.
    const options = { signal: this.controller.signal };
    this.watchdog = await this.client.reserve(options);
    this.checkBudget();
    this.work = await this.client.reserve(options);
    this.checkBudget();
    const [identity] = await this.work<
      (OwnedBackend & { receivedAt: string })[]
    >`select pg_backend_pid() as pid,
      backend_start::text as started,
      to_char(statement_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "receivedAt"
      from pg_stat_activity where pid=pg_backend_pid()`;
    if (!identity)
      throw createAppError('INFRASTRUCTURE', 'Transaction backend unavailable');
    this.backend = { pid: identity.pid, started: identity.started };
    this.metadata = Object.freeze({
      receivedAt: identity.receivedAt,
      writer: Object.freeze({
        pid: identity.pid,
        backendStart: identity.started,
      }),
    });
    await this.runLifecycle('open');
    this.lifecycleOpened = this.lifecycle !== undefined;
    this.checkBudget();
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
      transactionContext(database, this.checkLifetime, this.refuseControl),
      this.controller.signal,
      this.metadata,
    );
    this.scopeClosed = true;
    this.checkBudget();
    this.committing = true;
    const completion = await this.work<{ command: string }>`commit`;
    if (completion.command !== 'COMMIT') {
      this.committing = false;
      throw createAppError(
        'INFRASTRUCTURE',
        'Transcript transaction did not commit',
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
    if (!this.lifecycle) return;
    this.controlInUse = true;
    await runTransactionLifecycle({
      control: this.watchdog!,
      now: this.now,
      deadline,
      refuse: this.refuseControl,
      run: (tx) =>
        outcome === 'open'
          ? this.lifecycle!.open(tx, this.metadata!)
          : this.lifecycle!.close(tx, this.metadata!, outcome),
    });
    this.controlInUse = false;
  }

  private async recover(error: unknown): Promise<never> {
    const recoveryDeadline = this.now() + 1000;
    this.controller.abort(error);
    this.destroyed = this.work !== undefined;
    // Never release an uncertain writer for another logical attempt on the same backend.
    void this.work?.close({ timeout: 0 }).catch(() => undefined);
    const absent = await this.confirmRollback(recoveryDeadline);
    this.controlRecovered = absent;
    await this.closeAbortedLifecycle(absent, recoveryDeadline);
    if (
      !absent ||
      this.committing ||
      (this.lifecycleOpened && !this.lifecycleClosed)
    )
      throw createAppError(
        'INFRASTRUCTURE',
        'Transcript transaction recovery pending',
        {
          recovery: 'pending',
          cause: error,
          settlement: transactionSettlement({
            client: this.client,
            backend: this.backend,
            absent,
            now: this.now,
          }),
        },
      );
    if (error === this.expired)
      throw createAppError('INFRASTRUCTURE', this.expired.message, {
        recovery: 'rolled-back',
      });
    if (isAppError(error)) throw error;
    throw createAppError(
      'INFRASTRUCTURE',
      'Transcript transaction failed',
      error,
    );
  }

  private async closeAbortedLifecycle(
    absent: boolean,
    recoveryDeadline: number,
  ) {
    if (absent && this.lifecycleOpened && !this.committing) {
      try {
        await this.runLifecycle('aborted', recoveryDeadline);
        this.lifecycleClosed = true;
      } catch {
        this.controlRecovered = false;
      }
    }
  }

  private confirmRollback(deadline: number): Promise<boolean> {
    if (this.work === undefined) return Promise.resolve(true);
    if (this.controlInUse) {
      void this.watchdog?.close({ timeout: 0 }).catch(() => undefined);
      return Promise.resolve(false);
    }
    const remaining = deadline - this.now();
    if (
      this.backend === undefined ||
      this.watchdog === undefined ||
      remaining <= 0
    )
      return Promise.resolve(false);
    return recoverTransactionBackend(this.watchdog, this.backend, remaining);
  }

  async run<T>(work: TransactionWork<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          this.controller.abort(this.expired);
          reject(this.expired);
        },
        Math.max(0, this.deadline - this.now()),
      );
    });
    try {
      return await Promise.race([this.execute(work), budget]);
    } catch (error) {
      return await this.recover(error);
    } finally {
      this.scopeClosed = true;
      this.controller.abort(this.disposed);
      if (timer !== undefined) clearTimeout(timer);
      // A destroyed connection returns via Bun's onClose, never as a reusable socket.
      if (!this.destroyed) this.work?.release();
      if (this.controlRecovered) this.watchdog?.release();
      else void this.watchdog?.close({ timeout: 0 }).catch(() => undefined);
    }
  }
}

/** One existing pool; two reservations per admitted writer retain recovery capacity. */
export function createBoundedTransaction({
  client,
  maxConnections,
  now,
  executionMs = TRANSACTION_MS,
  admissionWaitMs,
}: {
  readonly client: SQL;
  readonly maxConnections: number;
  /** Monotonic milliseconds, injected by the composition root. */
  readonly now: () => number;
  /** Execution slice including reservations/setup/commit; recovery may need another1000ms. */
  readonly executionMs?: number;
  /** The longest a writer queues for a slot; nothing has run when it is refused. */
  readonly admissionWaitMs?: number | undefined;
}): BoundedTransaction {
  if (
    !Number.isSafeInteger(executionMs) ||
    executionMs < 1 ||
    executionMs > TRANSACTION_MS
  )
    throw createAppError('INVARIANT', 'Invalid transaction execution budget');
  const { admit, leave } = createTransactionAdmission({
    maxConnections,
    waitMs: admissionWaitMs,
  });
  return async <T>(
    run: TransactionWork<T>,
    options?: TransactionOptions,
  ): Promise<T> => {
    const slice = options?.executionMs ?? executionMs;
    if (!Number.isSafeInteger(slice) || slice < 1 || slice > executionMs)
      throw createAppError('INVARIANT', 'Invalid transaction execution budget');
    await admit();
    try {
      return await new TransactionAttempt(
        client,
        now,
        slice,
        options?.lifecycle,
      ).run(run);
    } finally {
      leave();
    }
  };
}
