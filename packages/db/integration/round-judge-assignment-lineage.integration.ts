import { sql as query } from 'drizzle-orm';
import { roundCommands } from '../src/schema/round-commands';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { Fixture, rejectedBy, sqlStateOf } from './constraint-helpers';
import { oneOnOneDefinition, oneOnOneSettings } from '../src/reference-formats';
import {
  resolveRoomConfiguration,
  createRoundRuntime,
  judgingJobEndReason,
} from '@daisy/debate-engine';
import { voidLockedRoundSource } from '../src/round-source-void';
import { lockAuthorizationActors } from '../src/authorization';
import { hydrateRoundRows } from '../src/round-hydration';
import { lockedRoundVersion } from '../src/round-projection-writer';
import { commitRoundCommand } from '../src/round-command-commit';
import { readDatabaseTime } from '../src/database-clock';
import { assertRejects } from '@daisy/errors/testing';
import { drizzle } from 'drizzle-orm/bun-sql';
import { roundOperations } from '../src/round-operations';
import { createId } from '@paralleldrive/cuid2';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

async function withJudgedRound(
  work: (context: {
    readonly sql: SQL;
    readonly f: Fixture;
    readonly roundId: string;
    readonly actorId: string;
    readonly participantId: string;
    readonly declared: number;
  }) => Promise<void>,
) {
  const scratch = scratchDatabase(databaseUrl, 'judgeassignment');
  await scratch.create();
  const sql = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const f = new Fixture(sql);
    const compiled = resolveRoomConfiguration(
      oneOnOneDefinition,
      oneOnOneSettings,
    );
    if (!compiled.ok)
      throw new Error('The original one-on-one revision did not compile');
    const roundId = createId();
    await roundOperations({ database: drizzle({ client: sql }) }).createRound({
      id: roundId,
      createdByActorId: null,
      resolution: 'Actual ordinary constructor boundary',
      competitionType: 'casual',
      formatId: 'one-on-one',
      formatVersion: 2,
      presetVersion: null,
      rules: compiled.rules,
    });
    const actorId = await f.actor();
    const { id: participantId } = await f.seat(roundId, 'judge', 0, actorId);
    await work({
      sql,
      f,
      roundId,
      actorId,
      participantId,
      declared: compiled.rules.seats.judges,
    });
  } finally {
    await sql.close();
    await scratch.drop();
  }
}

async function completeOrdinaryForfeit(
  sql: SQL,
  f: Fixture,
  roundId: string,
  judgeActorId: string,
) {
  const db = drizzle({ client: sql });
  const first = await f.seat(roundId, 'affirmative', 0),
    second = await f.seat(roundId, 'negative', 0);
  const actorIds = [judgeActorId, first.actorId, second.actorId];
  await db.transaction(async (tx) => {
    await lockAuthorizationActors(tx, actorIds, {
      maxActors: actorIds.length,
    });
    const current = await lockedRoundVersion(tx, roundId);
    const round = (await hydrateRoundRows(tx, roundId))!;
    const now = (await readDatabaseTime(tx)).toISOString();
    const projection = createRoundRuntime({
      ...round,
      round,
      nextSegmentId: createId,
    }).execute({
      command: { type: 'forfeit' },
      actorId: first.actorId,
      now,
    });
    await commitRoundCommand(tx, {
      roundId,
      current,
      projection,
      now,
      command: {
        commandId: createId(),
        actorId: first.actorId,
        serviceId: null,
        type: 'forfeit',
        payloadDigest: new Bun.CryptoHasher('sha3-256')
          .update('actual ordinary forfeit')
          .digest('hex'),
      },
    });
  });
  return actorIds;
}

test(
  'ordinary Round construction freezes judge slots and records actual initial identities',
  () =>
    withJudgedRound(
      async ({ sql, roundId, actorId, participantId, declared }) => {
        const slots =
          await sql`select slot,current_version,participant_id,actor_id from round_judge_slots where round_id=${roundId} order by slot`;
        const versions =
          await sql`select slot,version,previous_version,participant_id,actor_id,source,command_id from round_judge_assignments where round_id=${roundId} order by slot,version`;
        assert({
          given:
            'an ordinary Round on its original frozen grammar, then its actual first judge identity',
          should:
            'freeze every declared slot and retain the initial occupant as an immutable version without inventing a command',
          actual: {
            declared: declared,
            slots: [...slots],
            versions: [...versions],
          },
          expected: {
            declared: 1,
            slots: [
              {
                slot: 0,
                current_version: 1,
                participant_id: participantId,
                actor_id: actorId,
              },
            ],
            versions: [
              {
                slot: 0,
                version: 1,
                previous_version: null,
                participant_id: participantId,
                actor_id: actorId,
                source: 'initial',
                command_id: null,
              },
            ],
          },
        });
      },
    ),
  60_000,
);

test(
  'judge assignment versions retain identities, serialize stale writes and refuse retired identity resurrection',
  () =>
    withJudgedRound(async ({ sql, f, roundId, participantId, actorId }) => {
      const replacementActorId = await f.actor();
      const replacementId = createId();
      const commandId = createId();
      const append = async (input: {
        readonly commandId: string;
        readonly participantId: string | null;
        readonly actorId?: string;
        readonly roundVersion: number;
        readonly assignmentVersion: number;
      }) =>
        sql.begin(async (tx) => {
          if (input.actorId)
            await tx`insert into round_participants(id,round_id,actor_id,seat_kind,side,slot) values(${input.participantId},${roundId},${input.actorId},'judge',null,0)`;
          const result = {
            kind: 'judge_assignment',
            roundId,
            slot: 0,
            assignmentVersion: input.assignmentVersion + 1,
            participantId: input.participantId,
          };
          const digest = new Bun.CryptoHasher('sha3-256')
            .update(JSON.stringify(result))
            .digest('hex');
          await tx`insert into round_commands(command_id,round_id,actor_id,service_id,type,payload_digest,result,resulting_version,applied_at) values(${input.commandId},${roundId},${actorId},null,'change_judge',${digest},${result},${input.roundVersion + 1},date_trunc('milliseconds',clock_timestamp()))`;
          return tx`select public.daisy_append_round_judge_assignment(${roundId},0,${input.roundVersion},${input.assignmentVersion},${input.participantId},${input.commandId}) version`;
        });
      await append({
        commandId,
        participantId: replacementId,
        actorId: replacementActorId,
        roundVersion: 1,
        assignmentVersion: 1,
      });
      const replay =
        await sql`select public.daisy_append_round_judge_assignment(${roundId},0,1,1,${replacementId},${commandId}) version`;
      assert({
        given: 'a replacement and exact original command replay',
        should:
          'retain both identities but grant current authority only to the replacement without advancing on replay',
        actual: {
          replay: Number(replay[0]!.version),
          current: [
            ...(await sql`select id,public.daisy_round_participant_is_current(id) current from round_participants where round_id=${roundId} order by id`),
          ],
          version: Number(
            (await sql`select version from rounds where id=${roundId}`)[0]!
              .version,
          ),
        },
        expected: {
          replay: 2,
          current: [
            { id: participantId, current: false },
            { id: replacementId, current: true },
          ].sort((a, b) => a.id.localeCompare(b.id)),
          version: 2,
        },
      });
      const realtime = await sql.begin(async (tx) => {
        await tx`set local role daisy_realtime`;
        return tx`select public.daisy_round_participant_is_current(${participantId}) retired,public.daisy_round_participant_is_current(${replacementId}) replacement`;
      });
      assert({
        given:
          'the actual restricted realtime role reading retained and current identities',
        should:
          'derive only the current assignment without gaining mutation authority',
        actual: [
          realtime[0]!.retired,
          realtime[0]!.replacement,
          await sqlStateOf(() =>
            sql.begin(async (tx) => {
              await tx`set local role daisy_realtime`;
              await tx`delete from round_judge_slots where round_id=${roundId}`;
            }),
          ),
        ],
        expected: [false, true, '42501'],
      });
      assert({
        given: 'reusing the command with a changed occupant',
        should: 'refuse replay without writing lineage',
        actual: await rejectedBy(
          () =>
            sql`select public.daisy_append_round_judge_assignment(${roundId},0,1,1,${participantId},${commandId})`,
        ),
        expected: 'round_judge_assignment_replay',
      });
      const staleCommandId = createId();
      assert({
        given: 'another replacement with stale Round and slot versions',
        should: 'roll back its new identity and receipt',
        actual: await rejectedBy(() =>
          append({
            commandId: staleCommandId,
            participantId: createId(),
            actorId: replacementActorId,
            roundVersion: 1,
            assignmentVersion: 1,
          }),
        ),
        expected: 'round_judge_assignment_version',
      });
      assert({
        given: 'the failed stale transaction',
        should: 'leave exactly two identities and one accepted command',
        actual: [
          Number(
            (
              await sql`select count(*) n from round_participants where round_id=${roundId}`
            )[0]!.n,
          ),
          Number(
            (
              await sql`select count(*) n from round_commands where round_id=${roundId}`
            )[0]!.n,
          ),
        ],
        expected: [2, 1],
      });
      const unassignCommandId = createId();
      await append({
        commandId: unassignCommandId,
        participantId: null,
        roundVersion: 2,
        assignmentVersion: 2,
      });
      assert({
        given: 'explicit unassignment',
        should: 'retain the original frozen slot as empty with version3',
        actual: [
          ...(await sql`select slot,current_version,participant_id from round_judge_slots where round_id=${roundId}`),
        ],
        expected: [{ slot: 0, current_version: 3, participant_id: null }],
      });
      assert({
        given: 'trying to resurrect the first retired identity',
        should: 'refuse so old tokens and jobs cannot become current again',
        actual: await rejectedBy(() =>
          append({
            commandId: createId(),
            participantId,
            roundVersion: 3,
            assignmentVersion: 3,
          }),
        ),
        expected: 'round_judge_assignment_identity_reused',
      });
      assert({
        given: 'a retained retired identity',
        should: 'refuse rewriting or deleting it',
        actual: [
          await rejectedBy(
            () =>
              sql`update round_participants set actor_id=${replacementActorId} where id=${participantId}`,
          ),
          await rejectedBy(
            () => sql`delete from round_participants where id=${participantId}`,
          ),
        ],
        expected: [
          'round_participants_identity_immutable',
          'round_participants_identity_immutable',
        ],
      });
      assert({
        given: 'assignment history and frozen slot count',
        should: 'refuse removing either',
        actual: [
          await rejectedBy(
            () =>
              sql`delete from round_judge_assignments where round_id=${roundId}`,
          ),
          await rejectedBy(
            () => sql`delete from round_judge_slots where round_id=${roundId}`,
          ),
        ],
        expected: [
          'round_assignment_history_immutable',
          'round_judge_slots_frozen_count',
        ],
      });
      await sql`delete from rounds where id=${roundId}`;
      assert({
        given: 'deletion of the actual owning Round aggregate',
        should:
          'cascade identities and lineage while permitting no child-only erasure',
        actual: [
          Number(
            (
              await sql`select count(*) n from round_participants where round_id=${roundId}`
            )[0]!.n,
          ),
          Number(
            (
              await sql`select count(*) n from round_judge_assignments where round_id=${roundId}`
            )[0]!.n,
          ),
        ],
        expected: [0, 0],
      });
    }),
  60_000,
);

for (const ending of ['opening', 'completed'] as const)
  test(
    `ordinary source void preserves ${ending} provenance and exact replay`,
    () =>
      withJudgedRound(async ({ sql, f, roundId, actorId, participantId }) => {
        const db = drizzle({ client: sql });
        const commandId = createId();
        const actorIds =
          ending === 'completed'
            ? await completeOrdinaryForfeit(sql, f, roundId, actorId)
            : [actorId];
        const [before] =
          await sql`select status,completed_at,winning_side,version from rounds where id=${roundId}`;
        const input = {
          roundId,
          commandId,
          actorId,
          payloadDigest: new Bun.CryptoHasher('sha3-256')
            .update(commandId)
            .digest('hex'),
          expectedVersion: Number(before!.version),
          fencedActorIds: actorIds,
          // This test exercises the ordinary internal owner port, not a Tab authorization policy.
          authorize: ({
            round,
          }: {
            readonly round: { readonly id: string };
          }) => {
            if (round.id !== roundId) throw new Error('Wrong protected source');
          },
          stopProjection: ({
            round,
            now,
          }: Parameters<
            Parameters<typeof voidLockedRoundSource>[1]['stopProjection']
          >[0]) =>
            createRoundRuntime({
              ...round,
              round,
              nextSegmentId: createId,
            }).stop(now),
          judgingEndReason: judgingJobEndReason,
        };
        const run = (override: Partial<typeof input> = {}) =>
          db.transaction(async (tx) => {
            await lockAuthorizationActors(tx, actorIds, {
              maxActors: actorIds.length,
            });
            return voidLockedRoundSource(tx, { ...input, ...override });
          });
        const first = await run(),
          replay = await run();
        const [after] =
          await sql`select status,completed_at,winning_side,version from rounds where id=${roundId}`;
        const [voided] =
          await sql`select v.command_id,c.type,f.command_id terminal_command,a.assignment_version,a.participant_id from round_source_voids v join round_commands c on c.command_id=v.command_id join round_finalizations f on f.round_id=v.round_id join round_finalization_judge_assignments a on a.round_id=v.round_id where v.round_id=${roundId}`;
        assert({
          given: `a genuine ${ending} ordinary source, stopped or separately voided through its owner port`,
          should:
            'record one explicit void and preserve the actual terminal assignment witness',
          actual: {
            status: after!.status,
            version: Number(after!.version),
            replay: replay.replayed,
            firstVersion: first.resultingVersion,
            replayVersion: replay.resultingVersion,
            command: voided!.command_id,
            type: voided!.type,
            assignmentVersion: Number(voided!.assignment_version),
            participantId: voided!.participant_id,
            terminalPreserved:
              ending === 'opening'
                ? voided!.terminal_command === commandId
                : after!.completed_at.getTime() ===
                    before!.completed_at.getTime() &&
                  after!.winning_side === before!.winning_side &&
                  voided!.terminal_command !== commandId,
          },
          expected: {
            status: ending === 'opening' ? 'abandoned' : 'completed',
            version: Number(before!.version) + 1,
            replay: true,
            firstVersion: Number(before!.version) + 1,
            replayVersion: Number(before!.version) + 1,
            command: commandId,
            type: ending === 'opening' ? 'stop' : 'void_source',
            assignmentVersion: 1,
            participantId,
            terminalPreserved: true,
          },
        });
        await assertRejects({
          given: 'changed payload on source-void replay',
          should: 'refuse the changed command',
          actual: () => run({ payloadDigest: 'f'.repeat(64) }),
          code: 'CONFLICT',
        });
        const oldCount = Number(
          (
            await sql`select count(*) n from round_commands where round_id=${roundId}`
          )[0]!.n,
        );
        assert({
          given: 'a second distinct void command for the same source',
          should: 'refuse and roll back the new receipt',
          actual: await rejectedBy(() =>
            run({
              commandId: createId(),
              expectedVersion: Number(after!.version),
            }),
          ),
          expected: 'round_source_void_replay',
        });
        assert({
          given: 'the refused distinct void transaction',
          should: 'preserve accepted command count and the immutable void',
          actual: [
            Number(
              (
                await sql`select count(*) n from round_commands where round_id=${roundId}`
              )[0]!.n,
            ),
            await rejectedBy(
              () =>
                sql`delete from round_source_voids where round_id=${roundId}`,
            ),
          ],
          expected: [oldCount, 'round_assignment_history_immutable'],
        });
      }),
    60_000,
  );

test(
  'active construction does not reopen after the creating transaction commits',
  () =>
    withJudgedRound(async ({ sql, f, roundId }) => {
      await sql`update rounds set status='active',current_stage='countdown',started_at=clock_timestamp() where id=${roundId}`;
      assert({
        given: 'a committed active Round still at version1',
        should:
          'refuse appending a competitor after its constructor transaction',
        actual: await rejectedBy(() => f.seat(roundId, 'affirmative', 0)),
        expected: 'round_participants_fixed_cast',
      });
    }),
  60_000,
);

test(
  'retiring an unsubmitted judge after finalization preserves the actual terminal witness',
  () =>
    withJudgedRound(async ({ sql, f, roundId, actorId, participantId }) => {
      const actorIds = await completeOrdinaryForfeit(sql, f, roundId, actorId);
      const [before] =
        await sql`select completed_at,winning_side,version from rounds where id=${roundId}`;
      const snapshot =
        await sql`select * from round_finalization_judge_assignments where round_id=${roundId} order by slot`;
      const commandId = createId();
      await drizzle({ client: sql }).transaction(async (tx) => {
        await lockAuthorizationActors(tx, actorIds, {
          maxActors: actorIds.length,
        });
        await lockedRoundVersion(tx, roundId);
        const now = (await readDatabaseTime(tx)).toISOString();
        await tx.insert(roundCommands).values({
          commandId,
          roundId,
          actorId,
          serviceId: null,
          type: 'change_judge',
          payloadDigest: 'd'.repeat(64),
          result: {
            kind: 'judge_assignment',
            roundId,
            slot: 0,
            assignmentVersion: 2,
            participantId: null,
          },
          resultingVersion: Number(before!.version) + 1,
          appliedAt: new Date(now),
        });
        await tx.execute(
          query`select public.daisy_append_round_judge_assignment(${roundId},0,${Number(before!.version)},1,null,${commandId})`,
        );
      });
      const [after] =
        await sql`select status,completed_at,winning_side,version from rounds where id=${roundId}`;
      const [slot] =
        await sql`select current_version,participant_id from round_judge_slots where round_id=${roundId} and slot=0`;
      assert({
        given:
          'the approved unsubmitted retirement before a fixture result, after ordinary historical finalization',
        should:
          'retire current authority while preserving the exact terminal panel and ending',
        actual: {
          status: after!.status,
          ended:
            after!.completed_at.getTime() === before!.completed_at.getTime(),
          winner: after!.winning_side,
          version: Number(after!.version),
          current: [slot!.current_version, slot!.participant_id],
          terminal: [
            ...(await sql`select * from round_finalization_judge_assignments where round_id=${roundId} order by slot`),
          ],
          oldAuthority: (
            await sql`select public.daisy_round_participant_is_current(${participantId}) current`
          )[0]!.current,
        },
        expected: {
          status: 'completed',
          ended: true,
          winner: before!.winning_side,
          version: Number(before!.version) + 1,
          current: [2, null],
          terminal: [...snapshot],
          oldAuthority: false,
        },
      });
    }),
  60_000,
);
