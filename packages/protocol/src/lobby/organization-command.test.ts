import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { parseEach, parsedUnchanged } from '../parse-outcome.test-support';
import {
  organizationCommandCatalogue,
  organizationCommandEnvelopeSchema,
  organizationCommandSchema,
  organizationRefusals,
} from './organization-command';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');
const organizationId = id('organization');

const valid = [
  {
    type: 'create-organization',
    kind: 'league',
    name: 'Valley League',
    handle: 'valley-league',
  },
  {
    type: 'create-organization',
    kind: 'school',
    name: 'Hill School',
    handle: 'hill',
  },
  { type: 'update-organization', organizationId, name: 'Valley Debate League' },
  { type: 'invite-member', organizationId, userId: id('member') },
  { type: 'accept-membership', organizationId },
  { type: 'decline-membership', organizationId },
  { type: 'end-membership', organizationId, userId: id('member') },
  {
    type: 'give-grant',
    organizationId,
    userId: id('member'),
    roleId: id('role'),
    scope: { kind: 'organization' },
    expiresAt: null,
  },
  {
    type: 'give-grant',
    organizationId,
    userId: id('member'),
    roleId: id('role'),
    scope: { kind: 'lobby', lobbyId: id('lobby') },
    expiresAt: '2026-12-01T00:00:00.000Z',
  },
  { type: 'remove-grant', organizationId, grantId: id('grant') },
  { type: 'transfer-ownership', organizationId, userId: id('member') },
] as const;

describe('organizationCommandSchema', () => {
  test('its contract', () => {
    assert({
      given: 'every organization and grant command, each variant',
      should: 'accept it unchanged',
      actual: parseEach(organizationCommandSchema, valid),
      expected: parsedUnchanged(valid),
    });

    assert({
      given: 'a name with padding',
      should: 'read it trimmed',
      actual: organizationCommandSchema.parse({
        type: 'update-organization',
        organizationId,
        name: '  Valley  ',
      }),
      expected: { type: 'update-organization', organizationId, name: 'Valley' },
    });

    const [create, , update, invite, , , , give] = valid;
    assert({
      given: 'one invalid value per constraint',
      should: 'reject it at that field',
      actual: parseEach(organizationCommandSchema, [
        { ...create, kind: 'club' },
        { ...create, name: '   ' },
        { ...create, name: 'x'.repeat(121) },
        { ...create, handle: 'Valley' },
        { ...create, handle: 'va' },
        { ...create, handle: '-valley' },
        { ...update, organizationId: 'not-an-id' },
        { ...invite, userId: 'short' },
        { ...give, scope: { kind: 'season' } },
        { ...give, scope: { kind: 'lobby' } },
        { ...give, expiresAt: 'tomorrow' },
        { type: 'create-role', organizationId, name: 'Judge' },
      ]),
      expected: [
        { issues: ['kind'] },
        { issues: ['name'] },
        { issues: ['name'] },
        { issues: ['handle'] },
        { issues: ['handle'] },
        { issues: ['handle'] },
        { issues: ['organizationId'] },
        { issues: ['userId'] },
        { issues: ['scope.kind'] },
        { issues: ['scope.lobbyId'] },
        { issues: ['expiresAt'] },
        { issues: ['type'] },
      ],
    });

    assert({
      given: 'a command with a key it does not declare',
      should: 'reject the key',
      actual: parseEach(organizationCommandSchema, [
        { ...invite, roleId: id('role') },
        { ...give, scope: { kind: 'organization', lobbyId: id('lobby') } },
      ]),
      expected: [{ issues: ['(root)'] }, { issues: ['scope'] }],
    });

    assert({
      given: 'the envelope',
      should: 'carry one command with the versions it checks',
      actual: parseEach(organizationCommandEnvelopeSchema, [
        {
          version: 1,
          commandId: id('command'),
          expected: { organization: 3 },
          command: update,
        },
        {
          version: 1,
          commandId: id('command'),
          expected: { organization: 3 },
          command: update,
          extra: true,
        },
      ]),
      expected: [
        {
          data: {
            version: 1,
            commandId: id('command'),
            expected: { organization: 3 },
            command: update,
          },
        },
        { issues: ['(root)'] },
      ],
    });
  });
});

describe('organizationCommandCatalogue', () => {
  test('its contract', () => {
    const definitions = Object.values(organizationCommandCatalogue);

    assert({
      given: 'the command union',
      should: 'define every command, none of which creates or edits a role',
      actual: Object.keys(organizationCommandCatalogue),
      expected: organizationCommandSchema.options.map(
        (option) => option.shape.type.value,
      ),
    });

    assert({
      given: 'every definition',
      should: 'name refusals only from the closed list',
      actual: definitions.flatMap((definition) =>
        definition.refusals.filter(
          (refusal) => !organizationRefusals.includes(refusal),
        ),
      ),
      expected: [],
    });

    assert({
      given: 'the closed refusal list',
      should: 'have every refusal given by some command',
      actual: organizationRefusals.filter(
        (refusal) =>
          !definitions.some((definition) =>
            (definition.refusals as readonly string[]).includes(refusal),
          ),
      ),
      expected: [],
    });

    assert({
      given: 'every definition',
      should: 'gate on real capabilities and leave a history entry',
      actual: definitions.every(
        (definition) =>
          definition.history === 'entry' &&
          definition.aggregate === 'organization' &&
          definition.gate.every(
            (capability) =>
              authorizationCapabilitySchema.safeParse(capability).success,
          ),
      ),
      expected: true,
    });

    assert({
      given: 'the command types',
      should: 'include none that names a role as its subject',
      actual: Object.keys(organizationCommandCatalogue).filter((type) =>
        /role/.test(type),
      ),
      expected: [],
    });
  });
});
