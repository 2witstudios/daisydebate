import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createCleanupRechecks } from './cleanup-rechecks';
setupRitewayBun();
const key = (n: number) => `a${n.toString(36).padStart(23, '0')}`;

test('a finite ACK revisit pass returns to a now-due head despite a continuously growing tail', async () => {
  const ids = Array.from({ length: 33 }, (_, i) => key(i + 1));
  let due = false,
    reopened = false,
    largestPage = 0;
  const visited: string[] = [];
  const worker = createCleanupRechecks({
    failed: () => {
      throw Error('Unexpected recheck failure');
    },
    store: {
      rechecks: async (position) => {
        // Diagnostic old-wire fields below allow the immutable predecessor to run
        // as a negative control; production accepts only the current pass shape.
        const oldPosition: unknown = position;
        const afterId =
          typeof oldPosition === 'string' ? oldPosition : position?.afterId;
        const throughId =
          typeof oldPosition === 'string'
            ? ids.at(-1)!
            : (position?.throughId ?? ids.at(-1)!);
        const page = ids
          .filter((id) => (!afterId || id > afterId) && id <= throughId)
          .slice(0, 33);
        largestPage = Math.max(largestPage, page.length);
        visited.push(...page.slice(0, 32));
        const last = page.slice(0, 32).at(-1) ?? null;
        const exhausted = page.length <= 32;
        return {
          rows:
            due && !reopened && page.slice(0, 32).includes(key(1))
              ? [{ jobId: key(1) }]
              : [],
          afterId: last,
          exhausted,
          next: exhausted ? null : { afterId: last!, throughId },
        };
      },
      reopen: async (id) => {
        if (id !== key(1)) throw Error('Foreign recheck identity');
        reopened = true;
        return 'changed';
      },
    },
  });
  await worker.run();
  due = true;
  for (let tick = 0; tick < 64; tick++) {
    const start = ids.length;
    ids.push(...Array.from({ length: 33 }, (_, i) => key(start + i + 1)));
    await worker.run();
  }
  worker.stop();
  assert({
    given:
      '33 initial rows, an ACK becoming due below the cursor, then33 higher IDs per tick for65 bounded ticks',
    should:
      'revisit the due head without dropping the original tail or exceeding the33-row page',
    actual: [reopened, visited.includes(key(33)), largestPage, ids.length],
    expected: [true, true, 33, 2145],
  });
});

test('deleted pass boundary and an empty pass retire traversal without losing the next head', async () => {
  let ids: string[] = [];
  const positions: unknown[] = [];
  const worker = createCleanupRechecks({
    failed: () => {
      throw Error('Unexpected recheck failure');
    },
    store: {
      rechecks: async (pass) => {
        positions.push(pass ?? null);
        const throughId = pass?.throughId ?? ids.at(-1);
        const rows = ids
          .filter(
            (id) =>
              (!pass || id > pass.afterId) &&
              throughId !== undefined &&
              id <= throughId,
          )
          .slice(0, 33);
        return {
          rows: [],
          next:
            rows.length > 32
              ? { afterId: rows[31]!, throughId: throughId! }
              : null,
        };
      },
      reopen: async () => {
        throw Error('No due ACK in this cohort');
      },
    },
  });
  await worker.run();
  ids = Array.from({ length: 33 }, (_, i) => key(i + 1));
  await worker.run();
  ids = ids.filter((id) => id !== key(33));
  ids.push(...Array.from({ length: 33 }, (_, i) => key(i + 34)));
  await worker.run();
  await worker.run();
  worker.stop();
  await worker.run();
  assert({
    given:
      'an empty pass, then33 members with its last key deleted while a higher tail appears',
    should:
      'finish that captured range at an empty continuation and begin the next pass at head, stopping after shutdown',
    actual: positions,
    expected: [null, null, { afterId: key(32), throughId: key(33) }, null],
  });
});
