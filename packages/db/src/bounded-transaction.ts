import type { ReservedSQL, SQL } from 'bun';
import { createAppError, isAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import { synchronizedTransactionClient } from './transaction-client';
import {
  transactionContext,
  type BoundedTransactionContext,
} from './transaction-context';
import {
  recoverTransactionBackend,
  type OwnedBackend,
} from './transaction-watchdog';

const TRANSACTION_MS = 3000;
type TransactionWork<T> = (
  tx: BoundedTransactionContext,
  signal: AbortSignal,
) => Promise<T>;
export type BoundedTransaction = <T>(run: TransactionWork<T>) => Promise<T>;

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

  constructor(
    private readonly client: SQL,
    private readonly now: () => number,
  ) {
    this.deadline = now() + TRANSACTION_MS;
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
    [this.backend] = await this.work<
      OwnedBackend[]
    >`select pg_backend_pid() as pid,
      backend_start::text as started from pg_stat_activity where pid=pg_backend_pid()`;
    if (!this.backend)
      throw createAppError('INFRASTRUCTURE', 'Transaction backend unavailable');
    this.checkBudget();
    await this.work`begin`;
    await this.work`select set_config('statement_timeout', '2000', true),
      set_config('lock_timeout', '2000', true),
      set_config('idle_in_transaction_session_timeout', '2000', true)`;
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
    this.checkBudget();
    return result;
  }

  private async recover(error: unknown): Promise<never> {
    this.controller.abort(error);
    this.destroyed = this.work !== undefined;
    // Bun1.4.2 closes/cancels only this reserved socket, never the pool.
    void this.work?.close({ timeout: 0 }).catch(() => undefined);
    this.controlRecovered = await this.confirmRollback();
    if (!this.controlRecovered || this.committing)
      throw createAppError(
        'INFRASTRUCTURE',
        'Transcript transaction recovery pending',
        { recovery: 'pending', cause: error },
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

  private confirmRollback(): Promise<boolean> {
    if (this.work === undefined) return Promise.resolve(true);
    if (this.backend === undefined || this.watchdog === undefined)
      return Promise.resolve(false);
    return recoverTransactionBackend(this.watchdog, this.backend);
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
}: {
  readonly client: SQL;
  readonly maxConnections: number;
  /** Monotonic milliseconds, injected by the composition root. */
  readonly now: () => number;
}): BoundedTransaction {
  let active = 0;
  return async <T>(run: TransactionWork<T>): Promise<T> => {
    if (
      !Number.isSafeInteger(maxConnections) ||
      maxConnections < 2 ||
      active >= Math.floor(maxConnections / 2)
    )
      throw createAppError(
        'INFRASTRUCTURE',
        'Transcript transaction capacity unavailable',
      );
    active += 1;
    try {
      return await new TransactionAttempt(client, now).run(run);
    } finally {
      active -= 1;
    }
  };
}
