import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { isAppError } from '@daisy/errors';
import { createDatabase } from '../src';
import { roundAuthoring, withFixture } from './constraint-helpers';
import { authoredRoundCommand } from './round-command.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('durable rounds survive reconnect; optimistic executions reject stale writers', () =>
  withFixture(url, async (fixture) => {
    const { roundId, database, rules, formatId, actorId } =
      await roundAuthoring(fixture, url);
    try {
      const healthy = await database.health();
      await database.createRound({
        id: roundId,
        createdByActorId: actorId,
        resolution: 'Architecture proof',
        competitionType: 'casual',
        formatId,
        formatVersion: 1,
        presetVersion: null,
        rules,
      });
      await database.close();
      const reopened = createDatabase({ url, nextActorId: createId });
      try {
        const stored = await reopened.getRound(roundId);
        const outcomes = await Promise.all(
          [1, 2].map(() =>
            reopened
              .executeRoundCommand({
                ...authoredRoundCommand({ roundId, actorId }, 1),
                buildProjection: () => ({
                  round: {
                    status: 'active',
                    currentStage: 'countdown',
                    startedAt: '2001-01-01T00:00:00.000Z',
                    completedAt: null,
                    outcome: null,
                    checkpoint: stored?.checkpoint ?? {
                      version: 1,
                      prep_consumed_ms: { affirmative: 0, negative: 0 },
                      active_prep: null,
                      floor: null,
                    },
                  },
                  segmentInserts: [],
                  segmentCloses: [],
                  effects: [],
                }),
              })
              .then(() => 'accepted')
              .catch((error: unknown) =>
                isAppError(error) ? error.code : 'unexpected',
              ),
          ),
        );
        const won = outcomes.filter((outcome) => outcome === 'accepted');
        const after = await reopened.getRound(roundId);
        assert({
          given:
            'a round written, the connection reopened, and two executions against version 1',
          should:
            'read the frozen rules back and let exactly one execution win, moving the round to active with a database-clock started_at, never the caller-provided one (ADR 0033 §3.2, ISSUE-37)',
          actual: {
            healthy,
            rules: stored?.rules.version,
            status: stored?.status,
            winners: won.length,
            refusals: outcomes.filter((outcome) => outcome !== 'accepted'),
            winner: {
              status: after?.status,
              callerTime: after?.startedAt === '2001-01-01T00:00:00.000Z',
              validTime: !Number.isNaN(Date.parse(after?.startedAt ?? '')),
            },
          },
          expected: {
            healthy: true,
            rules: 2,
            status: 'scheduled',
            winners: 1,
            refusals: ['CONFLICT'],
            winner: { status: 'active', callerTime: false, validTime: true },
          },
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  }));
