import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { parseEach, parsedUnchanged } from '../parse-outcome.test-support';
import {
  drawCommandCatalogue,
  drawCommandEnvelopeSchema,
  drawCommandSchema,
  drawRefusals,
} from './draw-command';

setupRitewayBun();

const id = (n: number) => `d${String(n).padStart(23, '0')}`;
const seed = 'ab'.repeat(32);

const commands = [
  { type: 'generate-draw', tabRoundId: id(1), resultCutoff: 2, seed },
  { type: 'assign-judges', drawId: id(2) },
  {
    type: 'edit-draw',
    basedOnDrawId: id(2),
    edits: [
      { type: 'move-entry', entryId: id(3), toFixtureId: id(4), position: 1 },
      { type: 'swap-sides', fixtureId: id(4) },
      { type: 'add-fixture', kind: 'pairing', entryIds: [id(5), id(6)] },
      { type: 'add-fixture', kind: 'section', entryIds: [id(5), id(6), id(7)] },
      { type: 'remove-fixture', fixtureId: id(8) },
      { type: 'set-bye', entryId: id(9) },
    ],
  },
  {
    type: 'publish-draw',
    drawId: id(2),
    overrides: [{ key: 'pairing.rematch', reason: 'Only two schools left' }],
  },
  { type: 'publish-draw', drawId: id(2), overrides: [] },
  { type: 'discard-draft', drawId: id(2) },
] as const;

describe('draw commands', () => {
  test('every valid payload parses unchanged', () => {
    assert({
      given: 'one payload per draw command and edit',
      should: 'parse each to itself',
      actual: parseEach(drawCommandSchema, commands),
      expected: parsedUnchanged(commands),
    });
  });

  test('each constraint refuses its own field', () => {
    const issues = parseEach(drawCommandSchema, [
      { ...commands[0], seed: 'xyz' },
      { ...commands[0], resultCutoff: -1 },
      { ...commands[0], resultCutoff: 1.5 },
      { ...commands[2], edits: [] },
      {
        ...commands[2],
        edits: [{ type: 'add-fixture', kind: 'bye', entryIds: [id(5), id(6)] }],
      },
      {
        ...commands[2],
        edits: [{ type: 'add-fixture', kind: 'pairing', entryIds: [id(5)] }],
      },
      {
        ...commands[2],
        edits: [
          { type: 'add-fixture', kind: 'pairing', entryIds: [id(5), id(5)] },
        ],
      },
      {
        ...commands[2],
        edits: [
          {
            type: 'move-entry',
            entryId: id(3),
            toFixtureId: id(4),
            position: -1,
          },
        ],
      },
      { ...commands[3], overrides: [{ key: 'pairing.rematch' }] },
      { ...commands[3], overrides: [{ key: 'room.seats', reason: 'x' }] },
      {
        ...commands[3],
        overrides: [
          { key: 'pairing.rematch', reason: 'a' },
          { key: 'pairing.rematch', reason: 'b' },
        ],
      },
    ]).map((outcome) => ('issues' in outcome ? outcome.issues : outcome));
    assert({
      given: 'payloads each breaking one constraint',
      should: 'name the field it breaks',
      actual: issues,
      expected: [
        ['seed'],
        ['resultCutoff'],
        ['resultCutoff'],
        ['edits'],
        ['edits.0.kind'],
        ['edits.0.entryIds'],
        ['edits.0.entryIds'],
        ['edits.0.position'],
        ['overrides.0.reason'],
        ['overrides.0.key'],
        ['overrides'],
      ],
    });
  });

  test('an unknown key is refused', () => {
    assert({
      given: 'a discard with a key the contract does not name',
      should: 'refuse it',
      actual: parseEach(drawCommandSchema, [{ ...commands[5], force: true }]),
      expected: [{ issues: ['(root)'] }],
    });
  });

  test('the envelope carries the command', () => {
    const envelope = {
      version: 1,
      commandId: id(20),
      expected: { draw: 2, entries: 4 },
      command: commands[3],
    };
    assert({
      given: 'a publish in the shared envelope',
      should: 'parse unchanged',
      actual: parseEach(drawCommandEnvelopeSchema, [envelope]),
      expected: parsedUnchanged([envelope]),
    });
  });
});

describe('draw catalogue', () => {
  test('every refusal a command names is in the group list, and each is used', () => {
    const named = Object.values(drawCommandCatalogue).flatMap(
      (definition) => definition.refusals as readonly string[],
    );
    assert({
      given: 'the draw catalogue',
      should: 'name only group refusals and leave none unused',
      actual: {
        outside: named.filter(
          (refusal) => !(drawRefusals as readonly string[]).includes(refusal),
        ),
        unused: drawRefusals.filter((refusal) => !named.includes(refusal)),
      },
      expected: { outside: [], unused: [] },
    });
  });
});
