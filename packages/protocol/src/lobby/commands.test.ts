import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { lobbyCommandCatalogue, lobbyCommandGroups } from './commands';
import { lobbyAggregateKinds } from './command';

setupRitewayBun();

const groups = Object.entries(lobbyCommandGroups);
const typesOf = (union: (typeof groups)[number][1][0]): string[] =>
  [...(union._zod.propValues['type'] ?? [])].map(String);

describe('the command catalogue (TAB-5.16)', async () => {
  test('every command is declared once', async () => {
    const declared = groups.flatMap(([, [union]]) => typesOf(union));
    assert({
      given: 'every command type in every group union',
      should: 'appear in exactly one group',
      actual: declared.length,
      expected: new Set(declared).size,
    });
    assert({
      given: 'every group',
      should: 'declare exactly the types its union carries',
      actual: groups
        .filter(
          ([, [union, catalogue]]) =>
            [...typesOf(union)].sort().join() !==
            Object.keys(catalogue).sort().join(),
        )
        .map(([name]) => name),
      expected: [],
    });
  });

  test('every command names a gate, its refusals and a history entry', async () => {
    const broken = Object.entries(lobbyCommandCatalogue).filter(
      ([, definition]) =>
        definition.gate.length === 0 ||
        !definition.gate.every(
          (gate) => authorizationCapabilitySchema.safeParse(gate).success,
        ) ||
        !Array.isArray(definition.refusals) ||
        definition.history !== 'entry' ||
        !lobbyAggregateKinds.includes(definition.aggregate),
    );
    assert({
      given: 'every command definition',
      should:
        'name a real gate capability, a refusal list, an aggregate and a history entry',
      actual: broken.map(([type]) => type),
      expected: [],
    });
  });

  test('no command creates or edits a role', async () => {
    assert({
      given: 'every command type',
      should: 'never create, edit or delete a role',
      actual: Object.keys(lobbyCommandCatalogue).filter((type) =>
        /^(create|edit|update|revise|delete|remove)-role/.test(type),
      ),
      expected: [],
    });
  });
});
