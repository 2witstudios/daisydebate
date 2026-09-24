import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src';
import {
  debateAuthoring,
  snapshotFor,
  withFixture,
} from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('durable records survive reconnect; optimistic writes reject stale updates', () =>
  withFixture(url, async (fixture) => {
    const { id, actorId, formatId, database, testOnly } = await debateAuthoring(
      fixture,
      url,
    );
    try {
      const healthy = await database.health();
      await database.createDebate({
        id,
        createdBy: actorId,
        resolution: 'Architecture proof',
        format: formatId,
        snapshot: snapshotFor(id, { format: formatId }),
        mode: 'casual',
        visibility: 'unlisted',
      });
      await database.close();
      const reopened = createDatabase({ url, nextActorId: createId });
      try {
        const stored = await reopened.getDebate(id);
        const outcomes = await Promise.all(
          [1, 2].map((value) =>
            testOnly.saveSnapshot({
              id,
              expectedVersion: 1,
              snapshot: snapshotFor(id, {
                format: formatId,
                phase: 'active',
                resolution: `attempt ${value}`,
              }),
              updatedAt: '2026-01-01T00:00:00.000Z',
            }),
          ),
        );
        const won = outcomes.filter(Boolean);
        assert({
          given:
            'a debate written, the connection reopened, and two concurrent writes against version 1',
          should:
            'read back the stored snapshot and projections, and let exactly one write win, moving the phase projection with it and stamping started_at from the database clock, never the caller (ADR 0033 §3.2, ISSUE-37)',
          actual: {
            healthy,
            snapshot: stored?.snapshot,
            projections: [stored?.mode, stored?.phase, stored?.visibility],
            winners: won.length,
            winner: {
              phase: won[0]?.phase,
              callerTime: won[0]?.startedAt === '2026-01-01T00:00:00.000Z',
              validTime: !Number.isNaN(Date.parse(won[0]?.startedAt ?? '')),
            },
          },
          expected: {
            healthy: true,
            snapshot: snapshotFor(id, { format: formatId }),
            projections: ['casual', 'waiting', 'unlisted'],
            winners: 1,
            winner: { phase: 'active', callerTime: false, validTime: true },
          },
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  }));
