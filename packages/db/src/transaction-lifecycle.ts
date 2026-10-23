import type { ReservedSQL } from 'bun';
import { createAppError } from '@daisy/errors';
import { drizzle } from 'drizzle-orm/bun-sql';
import {
  transactionContext,
  type BoundedTransactionContext,
} from './transaction-context';
import { synchronizedTransactionClient } from './transaction-client';

export type TransactionMetadata = {
  readonly receivedAt: string;
  readonly writer: { readonly pid: number; readonly backendStart: string };
};
export type TransactionLifecycle = {
  readonly open: (
    control: BoundedTransactionContext,
    metadata: TransactionMetadata,
  ) => Promise<void>;
  readonly close: (
    control: BoundedTransactionContext,
    metadata: TransactionMetadata,
    outcome: 'committed' | 'aborted',
  ) => Promise<void>;
};

/** The control facade exists only inside its adapter-owned transaction callback. */
export async function runTransactionLifecycle(input: {
  readonly control: ReservedSQL;
  readonly now: () => number;
  readonly deadline: number;
  readonly run: (tx: BoundedTransactionContext) => Promise<void>;
  readonly refuse: (message: string) => never;
}) {
  const expired = createAppError(
    'INFRASTRUCTURE',
    'Transaction lifecycle budget exceeded',
  );
  let scopeClosed = false;
  const poisoned = new AbortController();
  const refuse = (message: string): never => {
    poisoned.abort(createAppError('INVARIANT', message));
    return input.refuse(message);
  };
  const checkDeadline = () => {
    poisoned.signal.throwIfAborted();
    if (input.now() >= input.deadline) throw expired;
  };
  const checkLifetime = () => {
    if (scopeClosed)
      throw createAppError(
        'INVARIANT',
        'Transaction callback lifetime has ended',
      );
    checkDeadline();
  };
  const execute = async () => {
    checkDeadline();
    await input.control`begin isolation level read committed`;
    const backstop = String(
      Math.max(1, Math.floor(Math.min(2000, input.deadline - input.now()))),
    );
    await input.control`select set_config('statement_timeout', ${backstop}, true),
      set_config('lock_timeout', ${backstop}, true),
      set_config('idle_in_transaction_session_timeout', ${backstop}, true),
      set_config('standard_conforming_strings', 'on', true)`;
    checkDeadline();
    const database = drizzle({
      client: synchronizedTransactionClient(
        input.control,
        checkLifetime,
        refuse,
      ),
    });
    await input.run(transactionContext(database, checkLifetime, refuse));
    scopeClosed = true;
    checkDeadline();
    const result = await input.control<{ command: string }>`commit`;
    if (result.command !== 'COMMIT')
      throw createAppError(
        'INFRASTRUCTURE',
        'Transaction lifecycle did not commit',
      );
    checkDeadline();
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      execute(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => {
            scopeClosed = true;
            void input.control.close({ timeout: 0 }).catch(() => undefined);
            reject(expired);
          },
          Math.max(0, input.deadline - input.now()),
        );
      }),
    ]);
  } finally {
    scopeClosed = true;
    if (timer !== undefined) clearTimeout(timer);
  }
}
