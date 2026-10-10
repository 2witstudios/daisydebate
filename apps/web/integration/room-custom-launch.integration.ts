import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';

import { withRoomRuntime } from './room-runtime.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('custom unequal casts and ordered timing freeze alongside canonical quota and masked reads', async () => {
  await withRoomRuntime(async (f) => {
    f.openRoomLimit(1);
    const choice = (await f.operations.catalog(f.host)).find(
      (c) => c.formatId === 'foundation',
    )!;
    const definition = {
      ...choice.definition,
      seats: { affirmative: 2, negative: 1, judge: 1 },
      segments: [
        {
          key: 'N1',
          label: 'Negative first',
          type: 'speech' as const,
          side: 'negative' as const,
          slot: 0,
          defaultDurationMs: 61_000,
        },
        {
          key: 'A2',
          label: 'Affirmative second speaker',
          type: 'speech' as const,
          side: 'affirmative' as const,
          slot: 1,
          defaultDurationMs: 62_000,
        },
        {
          key: 'A1',
          label: 'Affirmative first speaker',
          type: 'speech' as const,
          side: 'affirmative' as const,
          slot: 0,
          defaultDurationMs: 63_000,
        },
        {
          key: 'NR',
          label: 'Negative reply',
          type: 'speech' as const,
          side: 'negative' as const,
          slot: 0,
          defaultDurationMs: 64_000,
        },
      ],
      configurable: {
        ...choice.definition.configurable,
        timing: {
          countdownMs: { min: 0, max: 60_000 },
          segmentDurationMs: Object.fromEntries(
            ['N1', 'A2', 'A1', 'NR'].map((key) => [
              key,
              { min: 60_000, max: 600_000 },
            ]),
          ),
        },
      },
    };
    const config = {
      ...choice.defaultConfig,
      speechTiming: {
        countdownMs: 0,
        segmentDurationOverrides: { A2: 123_000 },
      },
    };
    let view = (
      await f.create({
        visibility: 'private',
        selection: {
          kind: 'custom',
          definition,
          config,
          length: 'full',
          competitionType: 'casual',
        },
      })
    ).view;
    const initial = await f.snapshot(view.id);
    await assertRejects({
      given: 'the configured one-open-Room quota is reached',
      should: 'refuse another create',
      actual: () => f.create(),
      code: 'RATE_LIMIT',
    });
    await assertRejects({
      given: 'an outsider requests a private Room',
      should: 'mask denial as not found',
      actual: () => f.operations.view(f.outsider, view.id),
      code: 'NOT_FOUND',
    });
    assert({
      given: 'quota refusal and masked read',
      should: 'preserve complete durable state and exclude private discovery',
      actual: [
        await f.snapshot(view.id),
        (await f.operations.list(f.outsider)).length,
      ],
      expected: [initial, 0],
    });
    // A public join admits real principals; privacy then follows their durable membership.
    view = (
      await f.command(f.host, view, {
        type: 'update-details',
        title: view.title,
        topic: view.topic,
        visibility: 'public',
      })
    ).view;
    for (const [who, role, slot] of [
      [f.host, 'affirmative', 0],
      [f.guest, 'negative', 0],
      [f.outsider, 'affirmative', 1],
    ] as const)
      view = (await f.command(who, view, { type: 'claim-seat', role, slot }))
        .view;
    const judge = (await f.operations.castChoices(f.host)).find(
      (p) => p.eligible,
    )!;
    view = (
      await f.command(f.host, view, {
        type: 'assign-seat',
        actorId: judge.actorId,
        role: 'judge',
        slot: 0,
      })
    ).view;
    view = (
      await f.command(f.host, view, {
        type: 'update-details',
        title: view.title,
        topic: view.topic,
        visibility: 'private',
      })
    ).view;
    for (const who of [f.host, f.guest, f.outsider])
      view = (
        await f.command(who, view, {
          type: 'ready',
          expectedConsentVersion: view.participants.find(
            (p) => p.actorId === who.actorId,
          )!.consentVersion,
        })
      ).view;
    const joined = await f.operations.list(f.guest);
    assert({
      given: 'a member of a private cast',
      should: 'discover their authoritative Room',
      actual: joined.map((v) => v.id),
      expected: [view.id],
    });
    const launched = await f.command(f.host, view, { type: 'start-round' });
    const round = await f.operations.roundView(
      f.guest,
      launched.view.roundRef!.id,
    );
    assert({
      given:
        'unequal sides, repeated negative reply, non-alternating order, custom duration and AI judge',
      should: 'freeze exact rules, config and four real identities',
      actual: [
        round.rules.seats,
        round.rules.segments.map((s) => [s.key, s.side, s.slot, s.durationMs]),
        round.config,
        round.participants.length,
        round.participants.find((p) => p.actorId === judge.actorId)?.kind,
        round.visibility,
      ],
      expected: [
        definition.seats,
        [
          ['N1', 'negative', 0, 61_000],
          ['A2', 'affirmative', 1, 123_000],
          ['A1', 'affirmative', 0, 63_000],
          ['NR', 'negative', 0, 64_000],
        ],
        config,
        4,
        'bot',
        'private',
      ],
    });
    await f.sql`update users set username=null, deleted_at=statement_timestamp(),version=version+1 where id=${f.guest.userId}`;
    await assertRejects({
      given: 'a seated account becomes erased',
      should: 'mask its Round read despite earlier membership',
      actual: () => f.operations.roundView(f.guest, round.id),
      code: 'NOT_FOUND',
    });
  });
});

test('null interaction refusals preserve durable create and edit state', async () => {
  await withRoomRuntime(async (f) => {
    const choice = (await f.operations.catalog(f.host)).find(
      (c) => c.formatId === 'foundation',
    )!;
    const definition = {
      ...choice.definition,
      configurable: {
        ...choice.definition.configurable,
        interaction: {
          crossExModes: ['ordered' as const],
          interruptions: {
            modes: ['enabled' as const],
            minRemainingMs: { min: 0, max: 1000 },
          },
          yield: { enabledChoices: [true], returnsTimeChoices: [true] },
        },
      },
    };
    const config = {
      ...choice.defaultConfig,
      interruptions: { mode: 'enabled' as const, minRemainingMs: 0 },
      yielding: { allowed: true, returnsTime: true },
    };
    const selection = {
      kind: 'custom' as const,
      definition,
      config,
      length: 'full' as const,
      competitionType: 'casual' as const,
    };
    const view = (await f.create({ selection })).view;
    const initial = await f.snapshot(view.id);
    const inventory = () =>
      f.sql`select (select count(*) from rooms) rooms, (select count(*) from formats) formats, (select count(*) from format_revisions) revisions, (select count(*) from room_commands) commands, (select count(*) from outbox) events`;
    const before = await inventory();
    for (const field of ['interruptions', 'yielding'] as const) {
      const invalid = { ...config, [field]: null };
      await assertRejects({
        given: `custom creation omits required ${field}`,
        should: 'refuse before creating durable data',
        actual: () =>
          f.create({ selection: { ...selection, config: invalid } }),
        code: 'VALIDATION',
      });
      for (const type of ['update-config', 'update-format'] as const) {
        await assertRejects({
          given: `${type} omits required ${field}`,
          should:
            'refuse the illegal configuration through the command refusal contract',
          actual: () =>
            f.command(f.host, view, {
              type,
              config: invalid,
              ...(type === 'update-format' ? { definition } : {}),
            }),
          code: 'CONFLICT',
        });
      }
      assert({
        given: `refused ${field} create and edits`,
        should: 'preserve Room, receipts, formats and outbox',
        actual: [await f.snapshot(view.id), await inventory()],
        expected: [initial, before],
      });
    }
  });
});
