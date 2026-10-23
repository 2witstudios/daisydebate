import { assert, setupRitewayBun, test } from 'riteway/bun';
import { creditBotPublicationWindow } from './bot-publication-context';
import type { BoundedTransactionContext } from './transaction-context';

setupRitewayBun();
const target = {
  roundId: 'r'.repeat(24),
  roundParticipantId: 'p'.repeat(24),
  segmentId: 'g'.repeat(24),
};
/** Records inserts; an update extends a run when `touching` is true. */
const recording = (touching: boolean) => {
  const inserted: unknown[] = [];
  const update = {
    set: () => update,
    where: () => update,
    returning: async () => (touching ? [{ id: 'run' }] : []),
  };
  const tx = {
    update: () => update,
    insert: () => ({
      values: async (row: unknown) => {
        inserted.push(row);
      },
    }),
  } as unknown as BoundedTransactionContext;
  return { tx, inserted };
};
const credit = async (
  touching: boolean,
  window: { beforeMs: number; afterMs: number },
) => {
  const { tx, inserted } = recording(touching);
  await creditBotPublicationWindow(tx, target, window, () => 'new-run');
  return inserted;
};

test('an authorized window is stored as credit, extending the run it touches (DEC-212, DEC-218)', async () => {
  assert({
    given:
      'a window touching a stored run, a separate fractional one, and an empty one',
    should:
      'extend without inserting, insert outward-rounded bounds, and store nothing empty',
    actual: [
      await credit(true, { beforeMs: 1000, afterMs: 1100 }),
      await credit(false, { beforeMs: 1000.6, afterMs: 1100.2 }),
      await credit(false, { beforeMs: 1000, afterMs: 1000 }),
    ],
    expected: [
      [],
      [
        {
          id: 'new-run',
          ...target,
          creditedFrom: new Date(1000),
          creditedUntil: new Date(1101),
        },
      ],
      [],
    ],
  });
});
