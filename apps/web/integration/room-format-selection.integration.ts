import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import type { RoomCatalogChoice, RoomView } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';

requireTestServices(process.env);
setupRitewayBun();

const tuple = (choice: RoomCatalogChoice) => ({
  formatId: choice.formatId,
  formatVersion: choice.formatVersion,
  presetVersion: choice.preset.version,
});
const summary = (view: RoomView) => ({
  formatId: view.formatId,
  name: view.format.name,
  basis: view.format.basis?.formatId ?? null,
  standing: view.format.standing.kind,
});

test('a casual room chooses, edits and returns to a standard through the database', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const value = catalog.find((choice) => choice.formatId === 'value')!;
    const template = catalog.find((choice) => choice.formatId === 'nsda-ld')!;
    const created = (
      await f.create({
        selection: {
          kind: 'catalog',
          ...tuple(value),
          competitionType: 'casual',
        },
      })
    ).view;
    const edited = (
      await f.command(f.host, created, {
        type: 'update-config',
        config: {
          ...created.config,
          inRoundPrep: { enabled: true, budgetMsPerSide: 300_000 },
        },
      })
    ).view;
    const reset = (
      await f.command(f.host, edited, {
        type: 'select-format',
        intent: 'reset',
        ...tuple(value),
      })
    ).view;
    const chosen = (
      await f.command(f.host, reset, {
        type: 'select-format',
        intent: 'choose',
        ...tuple(template),
      })
    ).view;
    const [row] = await f.sql`
      select basis_format_id, basis_preset_version from rooms where id=${chosen.id}`;
    assert({
      given:
        'a room created on Value, its prep edited, Back to Value, then a league template chosen',
      should:
        'read Standard, Custom based on Value, Standard again, then Custom based on the template, persisting the basis',
      actual: {
        created: summary(created),
        edited: summary(edited),
        resetConfig: reset.config,
        reset: summary(reset),
        chosen: summary(chosen),
        row,
      },
      expected: {
        created: {
          formatId: 'value',
          name: 'Value',
          basis: 'value',
          standing: 'standard',
        },
        edited: {
          formatId: 'value',
          name: 'Value',
          basis: 'value',
          standing: 'custom',
        },
        resetConfig: value.preset.config,
        reset: {
          formatId: 'value',
          name: 'Value',
          basis: 'value',
          standing: 'standard',
        },
        chosen: {
          formatId: 'nsda-ld',
          name: template.label,
          basis: 'nsda-ld',
          standing: 'custom',
        },
        row: {
          basis_format_id: 'nsda-ld',
          basis_preset_version: template.preset.version,
        },
      },
    });
  });
});

test('select-format refuses what the policy refuses and leaves the room unchanged', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const value = catalog.find((choice) => choice.formatId === 'value')!;
    const policy = catalog.find((choice) => choice.formatId === 'policy')!;
    const view = (await f.create()).view;
    const before = await f.snapshot(view.id);
    await assertRejects({
      given: 'a stale preset version for a catalog format',
      should: 'refuse the choice',
      actual: () =>
        f.command(f.host, view, {
          type: 'select-format',
          intent: 'choose',
          ...tuple(value),
          presetVersion: value.preset.version + 1,
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a reset to a basis the custom room never had',
      should: 'refuse the reset',
      actual: () =>
        f.command(f.host, view, {
          type: 'select-format',
          intent: 'reset',
          ...tuple(policy),
        }),
      code: 'CONFLICT',
    });
    await assertRejects({
      given: 'a guest choosing the format',
      should: 'refuse a non-host',
      actual: () =>
        f.command(f.guest, view, {
          type: 'select-format',
          intent: 'choose',
          ...tuple(value),
        }),
      code: 'AUTHORIZATION',
    });
    assert({
      given: 'three refused selections',
      should:
        'leave the room, its receipts and its outbox exactly as they were',
      actual: await f.snapshot(view.id),
      expected: before,
    });
  });
});

test('ranked One-on-one stays creatable outside the picker', async () => {
  await withRoomRuntime(async (f) => {
    const [current] = await f.sql`
      select f.current_version as "formatVersion", p.version as "presetVersion"
        from formats f
        join format_presets p
          on p.format_id = f.id and p.format_version = f.current_version
         and p.superseded_at is null
       where f.id = 'one-on-one'`;
    const catalog = await f.operations.catalog(f.host);
    const view = (
      await f.create({
        selection: { kind: 'ranked', formatId: 'one-on-one', ...current },
      })
    ).view;
    assert({
      given: 'the current eligible One-on-one preset',
      should:
        'create a ranked room with no basis while the picker never lists One-on-one',
      actual: {
        competitionType: view.competitionType,
        formatId: view.formatId,
        basis: view.format.basis,
        listed: catalog.some((choice) => choice.formatId === 'one-on-one'),
      },
      expected: {
        competitionType: 'ranked',
        formatId: 'one-on-one',
        basis: null,
        listed: false,
      },
    });
  });
});

test('a room switches into and out of a striking format (FMT-2b)', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = await f.operations.catalog(f.host);
    const value = catalog.find((choice) => choice.formatId === 'value')!;
    const freestyle = catalog.find(
      (choice) => choice.formatId === 'freestyle',
    )!;
    const created = (
      await f.create({
        selection: {
          kind: 'catalog',
          ...tuple(value),
          competitionType: 'casual',
        },
      })
    ).view;
    const striking = (
      await f.command(f.host, created, {
        type: 'select-format',
        intent: 'choose',
        ...tuple(freestyle),
      })
    ).view;
    await assertRejects({
      given: 'leaving the draw with no resolution',
      should: 'refuse: a set-resolution format needs one',
      actual: () =>
        f.command(f.host, striking, {
          type: 'select-format',
          intent: 'choose',
          ...tuple(value),
        }),
      code: 'CONFLICT',
    });
    const back = (
      await f.command(f.host, striking, {
        type: 'select-format',
        intent: 'choose',
        ...tuple(value),
        topic: 'Cities should ban cars downtown',
      })
    ).view;
    const fresh = (
      await f.create(
        {
          topic: null,
          selection: {
            kind: 'catalog',
            ...tuple(freestyle),
            competitionType: 'casual',
          },
        },
        f.guest,
      )
    ).view;
    assert({
      given:
        'a Value room choosing Freestyle, then Value with a resolution, and a new Freestyle room',
      should:
        'clear the topic and run the strike, restore a set resolution, and create the striking room with no topic',
      actual: {
        striking: [
          summary(striking),
          striking.topic,
          striking.config.resolutionDraw.enabled,
        ],
        back: [summary(back), back.topic],
        fresh: [summary(fresh), fresh.topic],
        listed: catalog
          .filter((c) => c.role === 'standard')
          .map((c) => c.formatId),
      },
      expected: {
        striking: [
          {
            formatId: 'freestyle',
            name: 'Freestyle',
            basis: 'freestyle',
            standing: 'standard',
          },
          null,
          true,
        ],
        back: [
          {
            formatId: 'value',
            name: 'Value',
            basis: 'value',
            standing: 'standard',
          },
          'Cities should ban cars downtown',
        ],
        fresh: [
          {
            formatId: 'freestyle',
            name: 'Freestyle',
            basis: 'freestyle',
            standing: 'standard',
          },
          null,
        ],
        listed: ['policy', 'value', 'freestyle'],
      },
    });
  });
});
