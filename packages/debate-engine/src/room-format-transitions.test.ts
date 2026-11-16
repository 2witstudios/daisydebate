import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoomAssemblyState, RoomCommand } from '@daisy/protocol';
import { oneOnOneFormatFixture } from '@daisy/protocol/testing';
import { executeRoomCommand } from './room-assembly';
import { consent, edges, started, state } from './room-assembly.test-support';
import { oneOnOneSettings } from './runtime.test-support';
import type { FormatSelectionFacts } from './format-selection';
import { drawRoom, drawSettings } from './round-opening.test-support';

setupRitewayBun();

/** A league template with a fixed resolution: a casual starting point. */
const templateFacts: FormatSelectionFacts = {
  format: {
    id: 'nsda-ld',
    name: 'NSDA Lincoln-Douglas',
    leagues: ['NSDA'],
    catalogOwned: true,
    role: 'template',
    currentVersion: 1,
  },
  definition: oneOnOneFormatFixture,
  preset: {
    version: 3,
    formatVersion: 1,
    config: oneOnOneSettings,
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
  formatId: 'nsda-ld',
  formatVersion: 1,
  presetVersion: 3,
  ...overrides,
});

const run = (
  room: RoomAssemblyState,
  command: RoomCommand,
  facts: FormatSelectionFacts | null = templateFacts,
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
      given: 'the host choosing a template’s current preset',
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
        formatId: 'nsda-ld',
        formatVersion: 1,
        basis: {
          formatId: 'nsda-ld',
          presetVersion: 3,
          formatVersion: 1,
          name: 'NSDA Lincoln-Douglas',
          role: 'template',
          definition: oneOnOneFormatFixture,
          config: oneOnOneSettings,
        },
        catalogFormat: {
          name: 'NSDA Lincoln-Douglas',
          role: 'template',
          leagues: ['NSDA'],
        },
        config: oneOnOneSettings,
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
        refusal(run(room, selectFormat(room), templateFacts, 'other')),
        refusal(
          run({ ...room, competitionType: 'ranked' }, selectFormat(room)),
        ),
        refusal(run(started(room), selectFormat(room))),
        refusal(run(room, selectFormat(room), null)),
        refusal(
          run(room, selectFormat(room), {
            ...templateFacts,
            preset: { ...templateFacts.preset, current: false },
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
        'room-closed',
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
        formatId: 'nsda-ld',
        presetVersion: 3,
        formatVersion: 1,
        name: 'NSDA Lincoln-Douglas',
        role: 'template',
        definition: oneOnOneFormatFixture,
        config: oneOnOneSettings,
      },
      config: { ...oneOnOneSettings, inRoundPrep: { enabled: false } },
    };
    const outcome = run(room, selectFormat(room, { intent: 'reset' }), {
      ...templateFacts,
      format: { ...templateFacts.format, currentVersion: 2 },
      preset: { ...templateFacts.preset, current: false },
    });
    assert({
      given: 'Back to the template after the catalog published a newer preset',
      should: 'restore the room’s own pinned preset',
      actual: outcome.ok && {
        config: outcome.mutation.state.config,
        basis: outcome.mutation.state.basis && {
          formatId: outcome.mutation.state.basis.formatId,
          presetVersion: outcome.mutation.state.basis.presetVersion,
        },
      },
      expected: {
        config: oneOnOneSettings,
        basis: { formatId: 'nsda-ld', presetVersion: 3 },
      },
    });
  });

  test('the topic follows the draw state', () => {
    const drawn = drawRoom({ kind: 'bank', categories: ['policy', 'value'] });
    const freestyleFacts: FormatSelectionFacts = {
      ...templateFacts,
      format: {
        ...templateFacts.format,
        id: 'freestyle',
        name: 'Freestyle',
        leagues: [],
        role: 'standard',
      },
      definition: drawn.definition,
      preset: {
        ...templateFacts.preset,
        config: drawSettings(['policy', 'value']),
      },
    };
    const freestyle = (room: RoomAssemblyState, topic?: string) =>
      run(
        room,
        selectFormat(room, {
          formatId: 'freestyle',
          ...(topic === undefined ? {} : { topic }),
        }),
        freestyleFacts,
      );
    const template = (room: RoomAssemblyState, topic?: string) =>
      run(room, selectFormat(room, topic === undefined ? {} : { topic }));
    const topicOf = (outcome: ReturnType<typeof run>) =>
      outcome.ok ? outcome.mutation.state.topic : outcome.refusal;
    assert({
      given:
        'switching into a draw, out of one, and between draws, with and without a topic',
      should:
        'clear text entering a draw, take the host’s text leaving one, and refuse text a draw does not use',
      actual: {
        intoDraw: topicOf(freestyle(state())),
        intoDrawWithText: topicOf(freestyle(state(), 'A motion')),
        outOfDraw: topicOf(template(drawn, 'A new motion')),
        outOfDrawWithoutText: topicOf(template(drawn)),
        betweenDraws: topicOf(freestyle(drawn)),
        betweenDrawsWithText: topicOf(freestyle(drawn, 'A motion')),
      },
      expected: {
        intoDraw: null,
        intoDrawWithText: 'illegal-config',
        outOfDraw: 'A new motion',
        outOfDrawWithoutText: 'illegal-config',
        betweenDraws: null,
        betweenDrawsWithText: 'illegal-config',
      },
    });
  });
});
