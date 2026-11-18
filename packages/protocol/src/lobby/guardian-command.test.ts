import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorizationCapabilitySchema } from '../authorization';
import { parseEach, parsedUnchanged } from '../parse-outcome.test-support';
import {
  guardianCommandCatalogue,
  guardianCommandEnvelopeSchema,
  guardianCommandSchema,
  guardianRefusals,
} from './guardian-command';

setupRitewayBun();

const id = (seed: string) => seed.padEnd(24, 'x');
const guardianLinkId = id('link');

const valid = [
  {
    type: 'create-guardian-link',
    guardianUserId: id('parent'),
    wardUserId: id('ward'),
    through: { kind: 'direct' },
  },
  {
    type: 'create-guardian-link',
    guardianUserId: id('coach'),
    wardUserId: id('ward'),
    through: { kind: 'school', organizationId: id('school') },
  },
  { type: 'consent-guardian-link', guardianLinkId, noticeVersion: 2 },
  { type: 'add-guardian', guardianLinkId, guardianUserId: id('second') },
  {
    type: 'set-restriction',
    guardianLinkId,
    limitsLobbies: true,
    allowedLobbyIds: [id('lobbya'), id('lobbyb')],
    videoCap: 'officials',
  },
  {
    type: 'set-restriction',
    guardianLinkId,
    limitsLobbies: false,
    allowedLobbyIds: [],
    videoCap: 'lobby',
  },
  { type: 'end-guardian-link', guardianLinkId },
] as const;

describe('guardianCommandSchema', () => {
  test('its contract', () => {
    assert({
      given: 'every guardian command, each variant',
      should: 'accept it unchanged',
      actual: parseEach(guardianCommandSchema, valid),
      expected: parsedUnchanged(valid),
    });

    const [direct, school, consent, add, restrict] = valid;
    assert({
      given: 'one invalid value per constraint',
      should: 'reject it at that field',
      actual: parseEach(guardianCommandSchema, [
        { ...direct, wardUserId: direct.guardianUserId },
        {
          ...direct,
          through: { kind: 'league', organizationId: id('school') },
        },
        { ...school, through: { kind: 'school' } },
        { ...consent, noticeVersion: 0 },
        { ...consent, noticeVersion: 1.5 },
        { ...add, guardianUserId: 'nobody' },
        { ...restrict, allowedLobbyIds: [id('lobbya'), id('lobbya')] },
        { ...restrict, limitsLobbies: false },
        { ...restrict, videoCap: 'public' },
      ]),
      expected: [
        { issues: ['wardUserId'] },
        { issues: ['through.kind'] },
        { issues: ['through.organizationId'] },
        { issues: ['noticeVersion'] },
        { issues: ['noticeVersion'] },
        { issues: ['guardianUserId'] },
        { issues: ['allowedLobbyIds'] },
        { issues: ['allowedLobbyIds'] },
        { issues: ['videoCap'] },
      ],
    });

    assert({
      given: 'a command with a key it does not declare',
      should: 'reject the key',
      actual: parseEach(guardianCommandSchema, [
        { ...consent, consentedAt: '2026-11-14T00:00:00.000Z' },
        {
          ...direct,
          through: { kind: 'direct', organizationId: id('school') },
        },
      ]),
      expected: [{ issues: ['(root)'] }, { issues: ['through'] }],
    });

    assert({
      given: 'an envelope naming the link version',
      should: 'parse it',
      actual: guardianCommandEnvelopeSchema.safeParse({
        version: 1,
        commandId: id('command'),
        expected: { guardianLink: 4 },
        command: consent,
      }).success,
      expected: true,
    });
  });
});

describe('guardianCommandCatalogue', () => {
  test('its contract', () => {
    const definitions = Object.values(guardianCommandCatalogue);

    assert({
      given: 'the command union',
      should: 'define every command',
      actual: Object.keys(guardianCommandCatalogue),
      expected: guardianCommandSchema.options.map(
        (option) => option.shape.type.value,
      ),
    });

    assert({
      given: 'every definition',
      should: 'name refusals only from the closed list, and every one of them',
      actual: {
        outside: definitions.flatMap((definition) =>
          definition.refusals.filter(
            (refusal) => !guardianRefusals.includes(refusal),
          ),
        ),
        unused: guardianRefusals.filter(
          (refusal) =>
            !definitions.some((definition) =>
              (definition.refusals as readonly string[]).includes(refusal),
            ),
        ),
      },
      expected: { outside: [], unused: [] },
    });

    assert({
      given: 'every definition',
      should: 'gate on real capabilities and leave a history entry on the link',
      actual: definitions.every(
        (definition) =>
          definition.history === 'entry' &&
          definition.aggregate === 'guardian_link' &&
          definition.gate.every(
            (capability) =>
              authorizationCapabilitySchema.safeParse(capability).success,
          ),
      ),
      expected: true,
    });
  });
});
