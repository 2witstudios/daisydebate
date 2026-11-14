import type {
  AuthorizationDecision,
  AuthorizationInput,
} from '@daisy/auth/authorization';
import type {
  ActionHistoryEntry,
  LobbyCommandDefinition,
  LobbyCommandReceipt,
} from '@daisy/protocol/lobby/command';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  CommandDenied,
  refuse,
  runLobbyCommand,
  type CommandDecision,
  type CommandTransaction,
  type StoredCommand,
} from './run-command';

setupRitewayBun();

const id = (c: string) => c.repeat(24);
type Command = { readonly type: 'rename'; readonly name: string };
type Facts = { readonly version: number; readonly taken: readonly string[] };
type Write = { readonly table: 'lobbies'; readonly name: string };

const definition: LobbyCommandDefinition<'name-taken'> = {
  aggregate: 'lobby',
  gate: ['lobby.setup.manage'],
  versions: ['lobby'],
  refusals: ['name-taken'],
  history: 'entry',
};

const decide = (
  facts: Facts,
  command: Command,
): CommandDecision<'name-taken', Write> =>
  facts.taken.includes(command.name)
    ? refuse('name-taken')
    : {
        kind: 'accepted',
        aggregate: { kind: 'lobby', id: id('l') },
        resultingVersion: facts.version + 1,
        writes: [{ table: 'lobbies', name: command.name }],
        findings: [],
        fixtureChanges: [],
      };

const allow: AuthorizationDecision = {
  allow: true,
  authority: { kind: 'grant', grantId: id('g') },
  conflict: null,
};

type Store = {
  stored: StoredCommand | null;
  applied: { writes: readonly Write[]; history: ActionHistoryEntry }[];
  held: number;
  conflicts: number;
};

const run = async ({
  decision = allow,
  stored = null,
  expected = 3,
  name = 'Autumn Open',
}: {
  decision?: AuthorizationDecision;
  stored?: StoredCommand | null;
  expected?: number;
  name?: string;
} = {}) => {
  const store: Store = { stored, applied: [], held: 0, conflicts: 0 };
  const tx: CommandTransaction<Facts, Write> = {
    stored: async () => store.stored,
    facts: async () => ({ version: 3, taken: ['Taken'] }),
    authority: () =>
      ({
        principal: { kind: 'user', userId: id('u'), actorId: id('a') },
        resource: { kind: 'room_collection' },
        context: { account: null },
      }) as Omit<AuthorizationInput, 'capability'>,
    versions: (facts) => ({ lobby: facts.version }),
    scope: () => ({ kind: 'lobby', lobbyId: id('l') }),
    recordConflict: async () => {
      store.conflicts += 1;
      return id('c');
    },
    holdForConfirmation: async () => {
      store.held += 1;
      return {
        pendingCommandId: id('p'),
        expiresAt: '2026-11-15T00:00:00.000Z',
      };
    },
    apply: async (writes, history) => {
      store.applied.push({ writes, history });
    },
  };
  const answer = await runLobbyCommand(
    {
      transaction: (work) => work(tx),
      authorize: () => decision,
      digest: (value) =>
        JSON.stringify(value).length.toString(16).padStart(64, '0'),
      now: () => '2026-11-14T12:00:00.000Z',
    },
    {
      version: 1,
      commandId: id('k'),
      expected: { lobby: expected },
      command: { type: 'rename', name },
    },
    definition,
    decide,
  ).catch((error: unknown) => error);
  return { answer, store };
};

describe('runLobbyCommand (TAB-5.8)', async () => {
  test('an accepted command', async () => {
    const { answer, store } = await run();
    assert({
      given: 'a command its gate allows at the current version',
      should: 'answer accepted with a fresh receipt',
      actual: answer,
      expected: {
        kind: 'accepted',
        receipt: {
          commandId: id('k'),
          aggregate: { kind: 'lobby', id: id('l') },
          resultingVersion: 4,
          replayed: false,
          findings: [],
          fixtureChanges: [],
        },
      },
    });
    assert({
      given: 'an accepted command',
      should:
        'apply its writes with exactly one history entry naming the grant',
      actual: store.applied.map(({ writes, history }) => ({
        writes,
        authority: history.authority,
        actorUserId: history.actorUserId,
        resultingVersion: history.resultingVersion,
      })),
      expected: [
        {
          writes: [{ table: 'lobbies', name: 'Autumn Open' }],
          authority: { kind: 'grant', grantId: id('g') },
          actorUserId: id('u'),
          resultingVersion: 4,
        },
      ],
    });
  });

  test('replay and conflict by command id and digest', async () => {
    const first = await run();
    const history = first.store.applied[0]?.history;
    const receipt = (first.answer as { receipt: LobbyCommandReceipt }).receipt;
    const stored: StoredCommand = {
      actorUserId: history?.actorUserId ?? null,
      payloadDigest: history?.payloadDigest ?? '',
      receipt,
    };
    const again = await run({ stored });
    assert({
      given: 'the same command id with the same content',
      should: 'replay the stored receipt and write nothing',
      actual: { answer: again.answer, writes: again.store.applied.length },
      expected: {
        answer: { kind: 'accepted', receipt: { ...receipt, replayed: true } },
        writes: 0,
      },
    });
    const different = await run({ stored, name: 'Another name entirely' });
    assert({
      given: 'the same command id with different content',
      should: 'refuse command-conflict and write nothing',
      actual: {
        answer: different.answer,
        writes: different.store.applied.length,
      },
      expected: {
        answer: { kind: 'refused', refusal: 'command-conflict' },
        writes: 0,
      },
    });
  });

  test('refusals change nothing', async () => {
    const stale = await run({ expected: 2 });
    const taken = await run({ name: 'Taken' });
    assert({
      given: 'a stale expected version, then a rule the decision refuses',
      should: 'answer each refusal and apply nothing',
      actual: [
        stale.answer,
        taken.answer,
        stale.store.applied.length + taken.store.applied.length,
      ],
      expected: [
        { kind: 'refused', refusal: 'version-conflict' },
        { kind: 'refused', refusal: 'name-taken' },
        0,
      ],
    });
  });

  test('the gate and conflicts', async () => {
    const denied = await run({
      decision: { allow: false, reason: 'missing-capability', conflict: null },
    });
    assert({
      given: 'a gate the evaluator denies',
      should: 'raise a denial, not a refusal',
      actual: denied.answer instanceof CommandDenied,
      expected: true,
    });
    const connections = [{ basis: 'seated' }] as never;
    const confirming = await run({
      decision: {
        ...allow,
        conflict: { connections, handling: 'second_confirms', waiverId: null },
      },
    });
    assert({
      given: 'a conflict whose handling asks a second person to confirm',
      should: 'hold the command, record the conflict and change nothing',
      actual: {
        answer: confirming.answer,
        held: confirming.store.held,
        conflicts: confirming.store.conflicts,
        writes: confirming.store.applied.length,
      },
      expected: {
        answer: {
          kind: 'pending',
          pendingCommandId: id('p'),
          expiresAt: '2026-11-15T00:00:00.000Z',
        },
        held: 1,
        conflicts: 1,
        writes: 0,
      },
    });
    const flagged = await run({
      decision: {
        ...allow,
        conflict: { connections, handling: 'flagged', waiverId: null },
      },
    });
    assert({
      given: 'a flagged conflict',
      should: 'apply the command with the conflict on its history entry',
      actual: flagged.store.applied[0]?.history.conflictId,
      expected: id('c'),
    });
  });
});
