import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { parseEach, parsedUnchanged } from '../parse-outcome.test-support';
import { otherValues } from '../settings/settings.test-support';
import {
  settingCommandCatalogue,
  settingCommandDefinition,
  settingCommandEnvelopeSchema,
  settingCommandSchema,
  settingRefusals,
  type SettingCommand,
} from './setting-command';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');
const at = (kind: 'organization' | 'template' | 'lobby' | 'event') => ({
  kind,
  id: id(kind),
});
const templateId = id('template');
const eventId = id('event');

const valid = [
  {
    type: 'set-setting',
    scope: at('organization'),
    key: 'pairing.preset',
    value: otherValues['pairing.preset'],
    hold: 'enforced',
  },
  {
    type: 'set-setting',
    scope: at('template'),
    key: 'judging.panel',
    value: otherValues['judging.panel'],
    hold: 'default',
  },
  {
    type: 'set-setting',
    scope: at('event'),
    key: 'entry.cap',
    value: otherValues['entry.cap'],
    hold: 'default',
  },
  { type: 'clear-setting', scope: at('lobby'), key: 'audience.posting' },
  {
    type: 'create-template',
    organizationId: id('organization'),
    name: 'Varsity LD',
    format: { id: id('format'), version: 3 },
    ballotDefinition: null,
  },
  {
    type: 'create-template',
    organizationId: id('organization'),
    name: 'Novice LD',
    format: { id: id('format'), version: 3 },
    ballotDefinition: { id: id('ballot'), version: 1 },
  },
  { type: 'revise-template', templateId, name: 'Varsity Lincoln-Douglas' },
  { type: 'retire-template', templateId },
  { type: 'offer-template', lobbyId: id('lobby'), templateId },
  { type: 'withdraw-template', lobbyId: id('lobby'), templateId },
  { type: 'copy-template', eventId, templateId },
  { type: 'follow-template', eventId, templateId },
  { type: 'stop-following-template', eventId },
] as const;

/** Each union member's declared keys, a refined member's included. */
const shapeOf = (option: unknown): Record<string, unknown> => {
  const schema = option as {
    readonly shape?: Record<string, unknown>;
    readonly in?: { readonly shape: Record<string, unknown> };
  };
  return schema.shape ?? schema.in?.shape ?? {};
};
const commandTypes = settingCommandSchema.options.map(
  (option) => (shapeOf(option).type as { readonly value: string }).value,
);

describe('settingCommandSchema', () => {
  test('every setting and template command parses', () => {
    assert({
      given: 'every command, each variant',
      should: 'accept it unchanged',
      actual: parseEach(settingCommandSchema, valid),
      expected: parsedUnchanged(valid),
    });
  });

  test('one set command serves every key, its value read by the key', () => {
    assert({
      given: 'a valid value for every catalogue key, at a scope it allows',
      should: 'accept each with the one set-setting command',
      actual: Object.entries(otherValues).filter(
        ([key, value]) =>
          !settingCommandSchema.safeParse({
            type: 'set-setting',
            scope: at(key === 'entry.registration' ? 'lobby' : 'organization'),
            key,
            value,
            hold: 'default',
          }).success,
      ),
      expected: [],
    });

    assert({
      given: 'a value its schema trims',
      should: 'carry the value as the schema reads it',
      actual: settingCommandSchema.parse({
        type: 'set-setting',
        scope: at('lobby'),
        key: 'entry.divisions',
        value: {
          items: [
            {
              key: 'novice',
              label: '  Novice  ',
              eligibility: { kind: 'open' },
            },
          ],
        },
        hold: 'default',
      }),
      expected: {
        type: 'set-setting',
        scope: at('lobby'),
        key: 'entry.divisions',
        value: {
          items: [
            { key: 'novice', label: 'Novice', eligibility: { kind: 'open' } },
          ],
        },
        hold: 'default',
      },
    });
  });

  test('each constraint rejects its own invalid value', () => {
    const [enforce, , ownValue, clear, create, , revise] = valid;
    assert({
      given: 'one invalid value per constraint',
      should: 'reject it at that field',
      actual: parseEach(settingCommandSchema, [
        { ...enforce, key: 'pairing.colour' },
        { ...enforce, scope: { kind: 'stage', id: id('stage') } },
        { ...enforce, scope: { kind: 'lobby', id: 'lobby' } },
        // A key set only at an organization or a template.
        {
          ...enforce,
          scope: at('lobby'),
          key: 'pairing.method',
          value: otherValues['pairing.method'],
        },
        { ...enforce, value: { value: 'king_of_the_hill' } },
        { ...enforce, hold: 'locked' },
        // Nothing is enforced at an event.
        { ...ownValue, hold: 'enforced' },
        // A key that may never be enforced.
        {
          ...ownValue,
          scope: at('lobby'),
          key: 'entry.registration',
          value: { state: 'open' },
          hold: 'enforced',
        },
        { ...clear, key: 'room.colour' },
        { ...create, name: '  ' },
        { ...create, format: { id: id('format'), version: 0 } },
        { ...create, ballotDefinition: { id: id('ballot') } },
        { ...revise, name: '' },
      ]),
      expected: [
        { issues: ['key'] },
        { issues: ['scope.kind'] },
        { issues: ['scope.id'] },
        { issues: ['scope.kind'] },
        { issues: ['value.value'] },
        { issues: ['hold'] },
        { issues: ['hold'] },
        { issues: ['hold'] },
        { issues: ['key'] },
        { issues: ['name'] },
        { issues: ['format.version'] },
        { issues: ['ballotDefinition.version'] },
        { issues: ['name'] },
      ],
    });
  });

  test('no command changes a template pin', () => {
    const [, , , , , , revise] = valid;
    assert({
      given: 'a revision that names a format or a ballot definition',
      should: 'reject the key',
      actual: parseEach(settingCommandSchema, [
        { ...revise, format: { id: id('format'), version: 4 } },
        { ...revise, ballotDefinition: null },
      ]),
      expected: [{ issues: ['(root)'] }, { issues: ['(root)'] }],
    });

    assert({
      given: 'every command type',
      should:
        'carry a format or ballot definition only when creating a template',
      actual: settingCommandSchema.options
        .filter((option) => {
          const shape = shapeOf(option);
          return 'format' in shape || 'ballotDefinition' in shape;
        })
        .map((option) => (shapeOf(option).type as { value: string }).value),
      expected: ['create-template'],
    });
  });

  test('the envelope', () => {
    assert({
      given: 'a set-setting envelope naming the settings version',
      should: 'parse it, and refuse an undeclared key',
      actual: [
        settingCommandEnvelopeSchema.safeParse({
          version: 1,
          commandId: id('command'),
          expected: { settings: 2 },
          command: valid[0],
        }).success,
        settingCommandEnvelopeSchema.safeParse({
          version: 1,
          commandId: id('command'),
          expected: { settings: 2, setting: 1 },
          command: valid[0],
        }).success,
      ],
      expected: [true, false],
    });
  });
});

describe('settingCommandCatalogue', () => {
  const definitions = Object.values(settingCommandCatalogue);

  test('the catalogue', () => {
    assert({
      given: 'the command union',
      should: 'define every command, with one set and one clear for every key',
      actual: Object.keys(settingCommandCatalogue),
      expected: commandTypes,
    });

    assert({
      given: 'every definition',
      should: 'name refusals only from the closed list, and every one of them',
      actual: {
        outside: definitions.flatMap((definition) =>
          definition.refusals.filter(
            (refusal) => !settingRefusals.includes(refusal),
          ),
        ),
        unused: settingRefusals.filter(
          (refusal) =>
            !definitions.some((definition) =>
              definition.refusals.includes(refusal),
            ),
        ),
      },
      expected: { outside: [], unused: [] },
    });

    assert({
      given: 'every definition',
      should: 'gate on real capabilities and leave a history entry',
      actual: definitions.every(
        (definition) =>
          definition.history === 'entry' &&
          definition.gate.every(
            (capability) =>
              authorizationCapabilitySchema.safeParse(capability).success,
          ),
      ),
      expected: true,
    });
  });

  test('a setting command runs under its scope', () => {
    const run = (command: SettingCommand) => {
      const definition = settingCommandDefinition(command);
      return { aggregate: definition.aggregate, gate: definition.gate };
    };
    const clearAt = (
      kind: 'organization' | 'template' | 'lobby' | 'event',
    ): SettingCommand => ({
      type: 'clear-setting',
      scope: at(kind),
      key: 'entry.cap',
    });
    assert({
      given: 'a setting command at each scope, and a template command',
      should:
        'gate an organization or template on organization.manage and a lobby or event on lobby.setup.manage, its aggregate the scope',
      actual: [
        run(clearAt('organization')),
        run(clearAt('template')),
        run(clearAt('lobby')),
        run(clearAt('event')),
        run({ type: 'retire-template', templateId }),
      ],
      expected: [
        { aggregate: 'organization', gate: ['organization.manage'] },
        { aggregate: 'template', gate: ['organization.manage'] },
        { aggregate: 'lobby', gate: ['lobby.setup.manage'] },
        { aggregate: 'event', gate: ['lobby.setup.manage'] },
        { aggregate: 'template', gate: ['organization.manage'] },
      ],
    });
  });
});
