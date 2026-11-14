import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { z } from 'zod';
import { parseOutcome } from '../parse-outcome.test-support';
import {
  actionHistoryEntrySchema,
  commandReplay,
  fixtureChangeSchema,
  lobbyCommandEnvelope,
  type LobbyCommandReceipt,
} from './command';

setupRitewayBun();

const verdict = (schema: z.ZodType, input: unknown) => {
  const parsed = parseOutcome(schema, input);
  return 'data' in parsed ? 'accepted' : parsed.issues;
};

const id = (c: string) => c.repeat(24);
const envelope = lobbyCommandEnvelope(
  z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('rename'), name: z.string().min(1) }),
  ]),
);
const valid = {
  version: 1,
  commandId: id('k'),
  expected: { lobby: 3 },
  command: { type: 'rename', name: 'Autumn Open' },
};
const receipt: LobbyCommandReceipt = {
  commandId: id('k'),
  aggregate: { kind: 'lobby', id: id('l') },
  resultingVersion: 4,
  replayed: false,
  findings: [],
  fixtureChanges: [],
};

describe('the lobby command envelope (TAB-5.8)', async () => {
  test('parsing', async () => {
    const outcome = (input: unknown) => {
      const parsed = parseOutcome(envelope, input);
      return 'data' in parsed ? 'accepted' : parsed.issues;
    };
    assert({
      given:
        'a valid envelope, then a second version, an unknown version name, an unknown key, a creation with no versions',
      should: 'accept only the valid envelope and the creation',
      actual: [
        outcome(valid),
        outcome({ ...valid, version: 2 }),
        outcome({ ...valid, expected: { tournament: 1 } }),
        outcome({ ...valid, extra: true }),
        outcome({ ...valid, expected: {} }),
      ],
      expected: ['accepted', ['version'], ['expected'], ['(root)'], 'accepted'],
    });
  });

  test('replay', async () => {
    const stored = {
      actorUserId: id('u'),
      payloadDigest: 'a'.repeat(64),
      receipt,
    };
    assert({
      given:
        'no stored command, the same actor and digest, another digest, another actor',
      should: 'be new, replay the receipt, and conflict twice',
      actual: [
        commandReplay(null, stored),
        commandReplay(stored, stored),
        commandReplay(stored, { ...stored, payloadDigest: 'b'.repeat(64) }),
        commandReplay(stored, { ...stored, actorUserId: id('v') }),
      ],
      expected: [
        { kind: 'new' },
        { kind: 'replay', receipt: { ...receipt, replayed: true } },
        { kind: 'conflict' },
        { kind: 'conflict' },
      ],
    });
  });

  test('history and fixture changes', async () => {
    const entry = {
      commandId: id('k'),
      scope: { kind: 'lobby', lobbyId: id('l') },
      aggregate: { kind: 'lobby', id: id('l') },
      type: 'rename',
      actorUserId: id('u'),
      authority: { kind: 'grant', grantId: id('g') },
      conflictId: null,
      confirmedByUserId: null,
      payloadDigest: 'a'.repeat(64),
      resultingVersion: 4,
      appliedAt: '2026-11-14T12:00:00.000Z',
    };
    assert({
      given:
        'a history entry, one with a grant authority missing its grant, a withdrawn and an officiated change',
      should:
        'accept the entry and both changes and refuse the broken authority',
      actual: [
        verdict(actionHistoryEntrySchema, entry),
        verdict(actionHistoryEntrySchema, {
          ...entry,
          authority: { kind: 'grant' },
        }),
        verdict(fixtureChangeSchema, {
          kind: 'withdrawn',
          fixtureId: id('f'),
          tabRoundId: id('t'),
          drawVersion: 2,
          people: [id('a')],
        }),
        verdict(fixtureChangeSchema, {
          kind: 'officiated',
          fixtureId: id('f'),
          tabRoundId: id('t'),
          commandId: id('k'),
          type: 'replace-judge',
          people: [],
        }),
      ],
      expected: ['accepted', ['authority.grantId'], 'accepted', 'accepted'],
    });
  });
});
