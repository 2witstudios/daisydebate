import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { requireTestServices } from '@daisy/config';
import { createObservationProjectionOperations } from '../src/observation-projection';
import { readObservationHeaders } from '../src/observation-headers';
import { withFixture, sqlStateOf } from './constraint-helpers';
import {
  projectionInput,
  projectionOwner,
  readCurrentProjection,
} from './observation.test-support';
import { createMessagingTestFixture } from '../src/messaging/test-fixture';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig, validRules } from './round-fixtures';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('actual projection role reads coherent restricted ISO history using numeric windows and exact disclosure/purge', async () => {
  await withFixture(url, async (f) => {
    const fixture = await createMessagingTestFixture(f.sql),
      db = drizzle({ client: f.sql });
    try {
      const messageId = createId();
      await f.sql`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values(${messageId},${fixture.channelId},${fixture.actorId},2147483648,2147483648,'Restricted body','2026-10-09T18:00:00.000Z')`;
      const resource = { kind: 'channel' as const, id: fixture.channelId };
      const [header] = await readObservationHeaders(db, [resource]);
      const owner = projectionOwner(db);
      const reader = createObservationProjectionOperations(owner);
      const input = projectionInput(header!, { after: 2147483649, limit: 1 });
      const result = await reader.readObservationProjection(input);
      assert({
        given:
          'column-restricted producer functions under actual projection role',
        should:
          'return safe-number sequence and existing ISO MessageRecord shape only',
        actual: { rows: result.rows, header: result.header },
        expected: {
          header,
          rows: [
            {
              id: messageId,
              channelId: fixture.channelId,
              authorActorId: fixture.actorId,
              sequence: 2147483648,
              changeVersion: 2147483648,
              text: 'Restricted body',
              createdAt: '2026-10-09T18:00:00.000Z',
              editedAt: null,
              removedAt: null,
            },
          ],
        },
      });
      await assertRejects({
        given: 'a descriptor whose disclosure revision was superseded',
        should: 'refuse rather than serve a body under old disclosure',
        actual: () =>
          reader.readObservationProjection({
            ...input,
            base: {
              ...input.base,
              disclosureRevision: header!.disclosureRevision + 1,
            },
          }),
        code: 'INFRASTRUCTURE',
      });
      await assertRejects({
        given: 'a minimum content revision newer than the committed header',
        should: 'refuse a body that predates the required content',
        actual: () =>
          reader.readObservationProjection({
            ...input,
            minimumContentRevision: header!.contentRevision + 1,
          }),
        code: 'INFRASTRUCTURE',
      });
      const empty = await reader.readObservationProjection({
        ...input,
        base: { ...input.base, window: { after: 2147483648, limit: 1 } },
      });
      assert({
        given: 'an existing positive sequence cursor',
        should: 'apply sequence less-than descending with no cursor-ID lookup',
        actual: empty.rows,
        expected: [],
      });
      const denied = await f.sql.begin(async (tx) => {
        await tx`set local role daisy_projection`;
        return sqlStateOf(() => tx`select token from session`);
      });
      assert({
        given: 'raw secret columns under projection role',
        should: 'refuse direct access',
        actual: denied,
        expected: '42501',
      });
      await f.sql`update messaging_messages set text=null,removed_at='2026-10-09T18:01:00.000Z',change_version=2147483649 where id=${messageId}`;
      await assertRejects({
        given: 'purge advanced after a previous descriptor',
        should: 'refuse stale projection without returning old content',
        actual: () => reader.readObservationProjection(input),
        code: 'INFRASTRUCTURE',
      });
      const [current] = await readObservationHeaders(db, [resource]);
      const removed = await reader.readObservationProjection({
        ...input,
        purgeGeneration: current!.purgeGeneration,
        minimumContentRevision: current!.contentRevision,
      });
      assert({
        given: 'current removal fence',
        should: 'expose no removed text, command or digest fields',
        actual: removed.rows[0]?.text,
        expected: null,
      });
    } finally {
      await fixture.cleanup();
    }
  });
});

test('Room and Round providers expose only fixed shared envelopes under the projection role', async () => {
  await withFixture(url, async (f) => {
    const subject = await createAuthorizationSubject(f),
      roomId = createId(),
      formatId = await f.format(),
      seatId = createId();
    await f.insert('rooms', {
      id: roomId,
      host_actor_id: subject.actorId,
      title: 'Safe shared Room',
      topic: 'Topic',
      visibility: 'public',
      format_id: formatId,
      format_version: 1,
      competition_type: 'casual',
      length: 'full',
      config: validConfig,
      execution_plan: { preRoundPrep: { enabled: false } },
      rules_snapshot: validRules,
      status: 'assembling',
    });
    await f.insert('room_participants', {
      id: seatId,
      room_id: roomId,
      actor_id: subject.actorId,
      role: 'affirmative',
      slot: 0,
      readiness_version: 7,
      readiness_command_id: createId(),
    });
    const roundId = await f.round({
      created_by_actor_id: subject.actorId,
      visibility: 'public',
    });
    const db = drizzle({ client: f.sql });
    const kinds = ['room', 'round'] as const;
    const rows = [];
    for (const kind of kinds) {
      const resource = { kind, id: kind === 'room' ? roomId : roundId };
      rows.push((await readCurrentProjection(db, resource)).rows[0]!);
    }
    const [room, round] = rows;
    assert({
      given: 'real restricted Room and Round provider SQL',
      should:
        'return bounded durable baseline/rules/checkpoint and omit command IDs, capabilities and actor-private overlays',
      actual: {
        roomKeys: Object.keys(room!).sort(),
        room: room!.room,
        participants: room!.participants,
        roundKeys: Object.keys(round!).sort(),
        checkpoint: round!.checkpoint,
      },
      expected: {
        roomKeys: ['definition', 'participants', 'room', 'roundRef', 'rules'],
        room: {
          id: roomId,
          hostActorId: subject.actorId,
          title: 'Safe shared Room',
          topic: 'Topic',
          visibility: 'public',
          status: 'assembling',
          version: 1,
          changeVersion: 1,
          formatId,
          formatVersion: 1,
          presetVersion: null,
          competitionType: 'casual',
          length: 'full',
          config: validConfig,
          executionPlan: { preRoundPrep: { enabled: false } },
          prepStartedAt: null,
          prepRemainingMs: null,
        },
        participants: [
          {
            id: seatId,
            actorId: subject.actorId,
            role: 'affirmative',
            slot: 0,
            readinessVersion: 7,
          },
        ],
        roundKeys: ['checkpoint', 'participants', 'round', 'rules', 'segments'],
        checkpoint: {
          version: 1,
          prep_consumed_ms: { affirmative: 0, negative: 0 },
          active_prep: null,
          floor: null,
        },
      },
    });
  });
});
