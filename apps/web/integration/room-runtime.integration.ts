import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { withRoomRuntime } from './room-runtime.test-support';
setupRitewayBun();

test('Room refusals preserve durable state and Ready retries cannot revive withdrawn or expired consent', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    assert({
      given: 'two human seats with current consent',
      should: 'project host eligibility',
      actual: {
        canStart: view.capabilities.canStart,
        refusal: view.startRefusal,
        readiness: view.readiness.readyActorIds.length,
        available: view.readiness.available,
      },
      expected: {
        canStart: true,
        refusal: null,
        readiness: 2,
        available: true,
      },
    });
    const before = await f.snapshot(view.id);
    await assertRejects({
      given: 'a nonhost edit',
      should: 'refuse canonical authority',
      actual: () =>
        f.command(f.guest, view, {
          type: 'update-config',
          config: view.config,
        }),
      code: 'AUTHORIZATION',
    });
    await assertRejects({
      given: 'a stale version',
      should: 'refuse without changes',
      actual: () =>
        f.operations.command(f.host, view.id, {
          commandId: createId(),
          expectedVersion: view.version - 1,
          type: 'close',
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'refused edit and stale command',
      should: 'preserve all rows and doorbells',
      actual: await f.snapshot(view.id),
      expected: before,
    });
    const readyId = createId(),
      ready = {
        commandId: readyId,
        expectedVersion: view.version,
        type: 'ready' as const,
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      };
    view = (await f.operations.command(f.guest, view.id, ready)).view;
    view = (
      await f.command(f.guest, view, {
        type: 'unready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
    ).view;
    const withdrawn = await f.snapshot(view.id),
      replay = await f.operations.command(f.guest, view.id, ready);
    assert({
      given: 'an old Ready after Unready',
      should: 'replay its receipt without restoring consent or writing',
      actual: [
        replay.receipt.replayed,
        replay.view.capabilities.canStart,
        await f.snapshot(view.id),
      ],
      expected: [true, false, withdrawn],
    });
    await f.sql`delete from room_commands where command_id=${readyId}`;
    await assertRejects({
      given: 'the same Ready after log pruning',
      should: 'refuse consumed consent revision',
      actual: () => f.operations.command(f.guest, view.id, ready),
      code: 'CONFLICT',
    });
    view = (
      await f.command(f.guest, view, {
        type: 'ready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
    ).view;
    await f.expire(view, f.guest.actorId);
    view = await f.operations.view(f.host, view.id);
    await assertRejects({
      given: 'expired consent',
      should: 'refuse Launch',
      actual: () => f.command(f.host, view, { type: 'start-round' }),
      code: 'CONFLICT',
    });
    view = (
      await f.command(f.guest, view, {
        type: 'ready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
    ).view;
    const start = {
      commandId: createId(),
      expectedVersion: view.version,
      type: 'start-round' as const,
    };
    const results = await Promise.all([
      f.operations.command(f.host, view.id, start),
      f.operations.command(f.host, view.id, start),
    ]);
    const rounds = await f.sql`select * from rounds where room_id=${view.id}`;
    const seats =
      await f.sql`select actor_id from round_participants where round_id=${rounds[0]!.id} order by actor_id`;
    assert({
      given: 'concurrent identical Launch commands',
      should:
        'freeze one scheduled Round, rules, config, topic and real identities',
      actual: [
        results.map((r) => r.receipt.replayed).sort(),
        rounds.length,
        rounds[0]!.status,
        rounds[0]!.resolution,
        rounds[0]!.room_config_snapshot,
        rounds[0]!.rules_snapshot,
        seats.map((p: { actor_id: string }) => p.actor_id),
      ],
      expected: [
        [false, true],
        1,
        'scheduled',
        view.topic,
        view.config,
        view.rules,
        [f.host.actorId, f.guest.actorId].sort(),
      ],
    });
    const [outbox] =
      await f.sql`select count(*)::int count from outbox where topic=${`room:${view.id}`} and payload->>'entityVersion'=${String(results[0]!.view.changeVersion)}`;
    assert({
      given: 'accepted Launch and exact retry',
      should: 'commit exactly one corresponding doorbell',
      actual: outbox!.count,
      expected: 1,
    });
  });
});

test('create replay survives catalog advancement and refuses a changed payload without writes', async () => {
  await withRoomRuntime(async (f) => {
    const choice = (await f.operations.catalog(f.host)).find(
      (c) => c.formatId === 'foundation',
    )!;
    const body = {
      commandId: createId(),
      title: 'Pinned create',
      topic: 'Motion',
      visibility: 'public' as const,
      selection: {
        kind: 'catalog' as const,
        formatId: choice.formatId,
        formatVersion: choice.formatVersion,
        competitionType: 'casual' as const,
        length: 'full' as const,
        config: choice.defaultConfig,
      },
    };
    const first = await f.create(body);
    const before = await f.snapshot(first.view.id);
    try {
      await f.sql`insert into format_revisions (format_id,version,definition) select format_id,2,definition from format_revisions where format_id='foundation' and version=1`;
      await f.sql`update formats set current_version=2 where id='foundation'`;
      const retry = await f.operations.create(f.host, body);
      assert({
        given: 'an accepted create whose catalog has advanced',
        should: 'return the original receipt and pinned view without mutations',
        actual: [
          retry.receipt.replayed,
          retry.view.id,
          retry.view.formatVersion,
          await f.snapshot(first.view.id),
        ],
        expected: [true, first.view.id, 1, before],
      });
      await assertRejects({
        given: 'the same command ID with different title',
        should: 'refuse payload conflict',
        actual: () =>
          f.operations.create(f.host, { ...body, title: 'Changed' }),
        code: 'CONFLICT',
      });
      assert({
        given: 'a conflicted create retry',
        should: 'preserve all durable rows',
        actual: await f.snapshot(first.view.id),
        expected: before,
      });
    } finally {
      await f.sql`update formats set current_version=1 where id='foundation'`;
      await f.sql`delete from format_revisions where format_id='foundation' and version=2`;
    }
  });
});

test('outbox failure rolls back Launch including frozen Round and participants', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble(),
      before = await f.snapshot(view.id),
      name = `room_rollback_${createId()}`;
    try {
      await f.sql.unsafe(
        `CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.topic = 'room:${view.id}' THEN RAISE EXCEPTION 'proof rollback'; END IF; RETURN NEW; END $$`,
      );
      await f.sql.unsafe(
        `CREATE TRIGGER "${name}" BEFORE INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION "${name}"()`,
      );
      let refused = false;
      try {
        await f.command(f.host, view, { type: 'start-round' });
      } catch {
        refused = true;
      }
      assert({
        given: 'outbox append fails after frozen Round insertion',
        should: 'roll back Room, commands, Round and cast completely',
        actual: [refused, await f.snapshot(view.id)],
        expected: [true, before],
      });
    } finally {
      await f.sql.unsafe(`DROP TRIGGER IF EXISTS "${name}" ON outbox`);
      await f.sql.unsafe(`DROP FUNCTION IF EXISTS "${name}"()`);
    }
    const launched = await f.command(f.host, view, { type: 'start-round' });
    const read = await f.operations.roundView(
      f.guest,
      launched.view.roundRef!.id,
    );
    assert({
      given: 'a clean retry after rollback',
      should:
        'read one persisted scheduled Round with frozen config and null clock',
      actual: [
        read.status,
        read.config,
        read.startedAt,
        read.participants.length,
      ],
      expected: ['scheduled', view.config, null, 2],
    });
  });
});

test('a Redis write followed by transaction failure cannot establish consent after reconnect', async () => {
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    view = (
      await f.command(f.guest, view, {
        type: 'unready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
    ).view;
    const before = await f.snapshot(view.id);
    f.failAfterReady(true);
    let failed = false;
    try {
      await f.command(f.guest, view, {
        type: 'ready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      });
    } catch {
      failed = true;
    }
    f.failAfterReady(false);
    const reconnected = await f.operations.view(f.host, view.id);
    assert({
      given: 'Redis accepted a lease but PostgreSQL did not commit its fence',
      should:
        'leave all durable state unchanged and ignore the orphan lease on reconnect',
      actual: [
        failed,
        reconnected.capabilities.canStart,
        await f.snapshot(view.id),
      ],
      expected: [true, false, before],
    });
    f.unavailable(true);
    const lost = await f.operations.view(f.host, view.id);
    assert({
      given: 'Redis loss',
      should: 'project unavailable separately from false consent',
      actual: [
        lost.readiness.available,
        lost.startRefusal,
        lost.participants.every((p) => p.ready === 'unavailable'),
      ],
      expected: [false, 'readiness-unavailable', true],
    });
    await assertRejects({
      given: 'Start while Redis is unavailable',
      should: 'refuse without accepting durable mutation',
      actual: () => f.command(f.host, lost, { type: 'start-round' }),
      code: 'INFRASTRUCTURE',
    });
    const revoked = await f.command(f.host, lost, {
      type: 'unready',
      expectedConsentVersion: lost.participants.find(
        (p) => p.actorId === f.host.actorId,
      )!.consentVersion,
    });
    f.unavailable(false);
    const recovered = await f.operations.view(f.host, view.id);
    assert({
      given: 'Unready committed during Redis loss',
      should: 'remain withdrawn after reconnect',
      actual: [
        revoked.receipt.replayed,
        recovered.participants.find((p) => p.actorId === f.host.actorId)!.ready,
      ],
      expected: [false, 'not-ready'],
    });
  });
});

test('Start and Unready serialize on the same durable authority fence', async () => {
  await withRoomRuntime(async (f) => {
    const view = await f.assemble();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((resolve) => {
        enter = resolve;
      }),
      released = new Promise<void>((resolve) => {
        release = resolve;
      });
    f.gateConsent(async () => {
      f.gateConsent(null);
      enter();
      await released;
    });
    const start = f.command(f.host, view, { type: 'start-round' });
    await entered;
    const unready = f
      .command(f.guest, view, {
        type: 'unready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
      .then(
        () => null,
        (error) => error as Error,
      );
    release();
    const accepted = await start;
    await assertRejects({
      given: 'Start acquired the account/Room fence before Unready',
      should:
        'commit one Round and refuse subsequent Unready on the closed assembly',
      actual: async () => {
        const error = await unready;
        if (error) throw error;
      },
      code: 'CONFLICT',
    });
    assert({
      given: 'the serialized Start wins',
      should: 'expose exactly its scheduled Round reference',
      actual: accepted.view.roundRef?.status,
      expected: 'scheduled',
    });
  });
  await withRoomRuntime(async (f) => {
    let view = await f.assemble();
    view = (
      await f.command(f.guest, view, {
        type: 'unready',
        expectedConsentVersion: view.participants.find(
          (p) => p.actorId === f.guest.actorId,
        )!.consentVersion,
      })
    ).view;
    const before = await f.snapshot(view.id);
    await assertRejects({
      given: 'Unready acquired and committed the fence first',
      should: 'refuse Start without freezing a Round',
      actual: () => f.command(f.host, view, { type: 'start-round' }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the serialized Unready wins',
      should: 'leave all state unchanged on refused Start',
      actual: await f.snapshot(view.id),
      expected: before,
    });
  });
});
