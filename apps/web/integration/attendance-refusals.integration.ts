import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { withAttendanceRound } from './attendance.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual scoped receipts share one global command fence and refuse foreign seats, segments and terminal replay atomically', async () =>
  withAttendanceRound(async (own) =>
    withAttendanceRound(async (foreign) => {
      try {
        const principal = {
          kind: 'human',
          actorId: own.f.host.actorId,
        } as const;
        const envelope = {
          version: 1,
          commandId: createId(),
          segmentId: own.segmentId,
        } as const;
        const first = await own.attendance.checkIn(
          principal,
          own.roundId,
          envelope,
        );
        const before = await own.f.store.getRound(own.roundId);
        const foreignBefore = await foreign.f.store.getRound(foreign.roundId);
        await assertRejects({
          given: 'an actual segment belonging to another Round',
          should: 'reject before creating any receipt alias',
          actual: () =>
            own.attendance.checkIn(principal, own.roundId, {
              ...envelope,
              commandId: createId(),
              segmentId: foreign.segmentId,
            }),
          code: 'CONFLICT',
        });
        await assertRejects({
          given: 'an actual human seated only in another Round',
          should: 'freshly refuse seat authority',
          actual: () =>
            own.attendance.checkIn(
              { kind: 'human', actorId: foreign.f.host.actorId },
              own.roundId,
              { ...envelope, commandId: createId() },
            ),
          code: 'AUTHORIZATION',
        });
        await assertRejects({
          given:
            'a commandId already durably bound to another Round and principal',
          should:
            'refuse a second global namespace despite valid foreign seating',
          actual: () =>
            foreign.attendance.checkIn(
              { kind: 'human', actorId: foreign.f.host.actorId },
              foreign.roundId,
              { ...envelope, segmentId: foreign.segmentId },
            ),
          code: 'CONFLICT',
        });
        const [facts] = await own.f
          .sql`select (select count(*)::int from round_commands where round_id in (${own.roundId},${foreign.roundId}) and type='check_in') as aliases,(select count(*)::int from round_check_ins where round_id in (${own.roundId},${foreign.roundId})) as receipts,(select count(*)::int from round_check_in_attempts where round_id in (${own.roundId},${foreign.roundId}) and state='pending') as pending`;
        assert({
          given: 'all three actual scoped refusals',
          should:
            'preserve both competitive Rounds and the one first-stamp fact without unresolved work',
          actual: {
            own: await own.f.store.getRound(own.roundId),
            foreign: await foreign.f.store.getRound(foreign.roundId),
            facts,
          },
          expected: {
            own: before,
            foreign: foreignBefore,
            facts: { aliases: 1, receipts: 1, pending: 0 },
          },
        });
        const runtime = createRoundRuntimeOperations({
          store: own.f.store,
          nextSegmentId: createId,
        });
        await runtime.command(principal, own.roundId, {
          version: 1,
          commandId: createId(),
          expectedVersion: first.resultingVersion,
          command: { type: 'forfeit', participantId: first.participantId },
        });
        const terminal = await own.f.store.getRound(own.roundId);
        await assertRejects({
          given:
            'the original acknowledged command replayed after actual voluntary forfeit',
          should:
            'recheck terminal authority instead of replaying an attendance mutation',
          actual: () =>
            own.attendance.checkIn(principal, own.roundId, envelope),
          code: 'CONFLICT',
        });
        assert({
          given: 'terminal attendance rejection',
          should: 'leave the actual engine result and original facts unchanged',
          actual: {
            round: await own.f.store.getRound(own.roundId),
            receipts: (
              await own.f
                .sql`select command_id from round_check_ins where round_id=${own.roundId}`
            ).length,
          },
          expected: { round: terminal, receipts: 1 },
        });
      } finally {
        // Refused attempts retain their true foreign principal; erase the owning
        // Round aggregate before the nested fixture removes that foreign actor.
        await own.f
          .sql`delete from outbox where topic=${`debate:${own.roundId}`}`;
        await own.f.sql`delete from rounds where id=${own.roundId}`;
      }
    }),
  ));
