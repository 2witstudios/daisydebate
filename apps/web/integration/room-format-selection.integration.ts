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
    const catalog = (await f.operations.catalog(f.host)).choices;
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
    const catalog = (await f.operations.catalog(f.host)).choices;
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

test('a room switches into and out of a striking format (FMT-2b)', async () => {
  await withRoomRuntime(async (f) => {
    const catalog = (await f.operations.catalog(f.host)).choices;
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
      given: 'leaving a draw for Value with host-written replacement text',
      should: 'refuse: Value uses its published resolution',
      actual: () =>
        f.command(f.host, striking, {
          type: 'select-format',
          intent: 'choose',
          ...tuple(value),
          topic: 'Cities should ban cars downtown',
        }),
      code: 'CONFLICT',
    });
    const back = (
      await f.command(f.host, striking, {
        type: 'select-format',
        intent: 'choose',
        ...tuple(value),
      })
    ).view;
    const fresh = (
      await f.create(
        {
          resolution: { kind: 'strike' },
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
          'Privacy ought to be valued above public safety.',
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
