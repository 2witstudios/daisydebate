import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState, RoomCommand } from '@daisy/protocol';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, state } from './room-assembly.test-support';
import { oneOnOneConfig } from './runtime.test-support';
import type { FormatSelectionFacts } from './format-selection';

setupRitewayBun();

const valueFacts: FormatSelectionFacts = {
  format: {
    id: 'value',
    name: 'Value',
    leagues: [],
    catalogOwned: true,
    role: 'standard',
    currentVersion: 1,
  },
  definition: oneOnOneFormatFixture,
  preset: {
    version: 3,
    formatVersion: 1,
    config: oneOnOneConfig,
    rankedEligible: false,
    current: true,
  },
};

const selectFormat = (
  room: RoomAssemblyState,
  overrides: Partial<Extract<RoomCommand, { type: 'select-format' }>> = {},
): Extract<RoomCommand, { type: 'select-format' }> => ({
  type: 'select-format',
  commandId: 'select',
  expectedVersion: room.version,
  intent: 'choose',
  formatId: 'value',
  formatVersion: 1,
  presetVersion: 3,
  ...overrides,
});

const run = (
  room: RoomAssemblyState,
  command: RoomCommand,
  facts: FormatSelectionFacts | null = valueFacts,
  actor = 'host',
) =>
  executeRoomCommand(room, actor, command, consent, {
    ...edges,
    formatFacts: facts,
  });

describe('select-format', () => {
  test('choosing a catalog format', () => {
    const room = state();
    const outcome = run(room, selectFormat(room));
    assert({
      given: 'the host choosing a standard’s current preset',
      should:
        'adopt its definition and preset config, set the basis, advance the version and clear readiness',
      actual: outcome.ok && {
        formatId: outcome.mutation.state.formatId,
        formatVersion: outcome.mutation.state.formatVersion,
        basis: outcome.mutation.state.basis,
        catalogFormat: outcome.mutation.state.catalogFormat,
        config: outcome.mutation.state.config,
        definition: outcome.mutation.state.definition,
        version: outcome.mutation.state.version,
        consent: outcome.mutation.state.participants.map(
          (p) => p.consentCommandId,
        ),
        publishDefinition: outcome.mutation.publishDefinition,
      },
      expected: {
        formatId: 'value',
        formatVersion: 1,
        basis: {
          formatId: 'value',
          presetVersion: 3,
          formatVersion: 1,
          name: 'Value',
          role: 'standard',
          definition: oneOnOneFormatFixture,
          config: oneOnOneConfig,
        },
        catalogFormat: { name: 'Value', role: 'standard', leagues: [] },
        config: oneOnOneConfig,
        definition: oneOnOneFormatFixture,
        version: room.version + 1,
        consent: [null, null],
        publishDefinition: false,
      },
    });
  });

  test('refusals leave the room unchanged', () => {
    const room = state();
    const refusal = (outcome: ReturnType<typeof run>) =>
      outcome.ok ? 'accepted' : outcome.refusal;
    assert({
      given: 'select-format commands the room must refuse',
      should: 'refuse each with no mutation',
      actual: [
        refusal(run(room, selectFormat(room), valueFacts, 'other')),
        refusal(
          run({ ...room, competitionType: 'ranked' }, selectFormat(room)),
        ),
        refusal(
          run(
            { ...room, prepStartedAt: '2026-10-09T00:00:00.000Z' },
            selectFormat(room),
          ),
        ),
        refusal(run(room, selectFormat(room), null)),
        refusal(
          run(room, selectFormat(room), {
            ...valueFacts,
            preset: { ...valueFacts.preset, current: false },
          }),
        ),
        refusal(run(room, selectFormat(room, { intent: 'reset' }))),
        refusal(run(room, selectFormat(room, { topic: 'A new motion' }))),
        refusal(
          run(room, selectFormat(room, { expectedVersion: room.version + 1 })),
        ),
      ],
      expected: [
        'host-required',
        'illegal-config',
        'prep-running',
        'format-unavailable',
        'format-unavailable',
        'format-unavailable',
        'illegal-config',
        'version-conflict',
      ],
    });
  });

  test('seats', () => {
    const room = state();
    const crowded: RoomAssemblyState = {
      ...room,
      participants: [
        ...room.participants,
        {
          id: 'p3',
          actorId: 'second',
          label: 'Second',
          kind: 'human',
          role: 'affirmative',
          slot: 1,
          eligible: true,
          consentVersion: 0,
          consentCommandId: null,
        },
      ],
    };
    const outcome = run(crowded, selectFormat(crowded));
    assert({
      given: 'a debater in a seat the chosen format does not have',
      should: 'refuse seat-unavailable',
      actual: outcome.ok ? 'accepted' : outcome.refusal,
      expected: 'seat-unavailable',
    });
  });

  test('back to the pinned basis', () => {
    const room: RoomAssemblyState = {
      ...state(),
      basis: {
        formatId: 'value',
        presetVersion: 3,
        formatVersion: 1,
        name: 'Value',
        role: 'standard',
        definition: oneOnOneFormatFixture,
        config: oneOnOneConfig,
      },
      config: { ...oneOnOneConfig, inRoundPrep: { enabled: false } },
    };
    const outcome = run(room, selectFormat(room, { intent: 'reset' }), {
      ...valueFacts,
      format: { ...valueFacts.format, currentVersion: 2 },
      preset: { ...valueFacts.preset, current: false },
    });
    assert({
      given: 'Back to standard after the catalog published a newer preset',
      should: 'restore the room’s own pinned preset',
      actual: outcome.ok && {
        config: outcome.mutation.state.config,
        basis: outcome.mutation.state.basis && {
          formatId: outcome.mutation.state.basis.formatId,
          presetVersion: outcome.mutation.state.basis.presetVersion,
        },
      },
      expected: {
        config: oneOnOneConfig,
        basis: { formatId: 'value', presetVersion: 3 },
      },
    });
  });
});
