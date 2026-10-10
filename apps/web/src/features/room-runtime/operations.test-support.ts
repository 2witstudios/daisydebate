import { fixedIds } from '@daisy/clock';
import type { AccountAuthorizationFact } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import type { RoomAssemblyState, RoundView } from '@daisy/protocol';
import {
  foundationDefinition,
  oneOnOneDefinition,
  oneOnOneFullConfig,
} from '@daisy/db/reference-formats';
import { resolveRoomConfiguration } from '@daisy/debate-engine';
import { createRoomRuntimeOperations, type Store } from './operations';

export const caller = {
  userId: 'm4n6p8r2t4v6x8z1k3b5c7d9',
  actorId: 'a4n6p8r2t4v6x8z1k3b5c7d9',
};
export const account: AccountAuthorizationFact = {
  ...caller,
  member: true,
  erased: false,
  revision: 1,
};
export const now = '2026-10-10T12:00:00.000Z';
const resolved = resolveRoomConfiguration(
  oneOnOneDefinition,
  oneOnOneFullConfig,
);
if (!resolved.ok)
  throw new Error('The reference one-on-one config must resolve');

export const state: RoomAssemblyState = {
  id: 'r4n6p8r2t4v6x8z1k3b5c7d9',
  version: 1,
  changeVersion: 1,
  title: 'A persisted practice room',
  topic: 'Cities should make transit free',
  visibility: 'public',
  hostActorId: caller.actorId,
  hostLabel: 'Member',
  status: 'assembling',
  formatId: 'one-on-one',
  formatVersion: 1,
  presetVersion: null,
  competitionType: 'casual',
  length: 'full',
  definition: oneOnOneDefinition,
  config: oneOnOneFullConfig,
  executionPlan: resolved.roomPlan,
  rules: resolved.rules,
  participants: [
    {
      id: 'p4n6p8r2t4v6x8z1k3b5c7d9',
      actorId: caller.actorId,
      kind: 'human',
      label: 'Member',
      consentVersion: 0,
      consentCommandId: 'c4n6p8r2t4v6x8z1k3b5c7d9',
      role: 'affirmative',
      slot: 0,
      eligible: true,
    },
  ],
  prepStartedAt: null,
  prepRemainingMs: null,
  roundRef: null,
};

const catalog = [
  {
    id: 'one-on-one',
    name: 'One-on-one',
    version: 1,
    definition: oneOnOneDefinition,
    presets: [
      {
        version: 1,
        formatId: 'one-on-one',
        formatVersion: 1,
        length: 'full',
        config: oneOnOneFullConfig,
      },
    ],
  },
  {
    id: 'foundation',
    name: 'Foundation',
    version: 1,
    definition: foundationDefinition,
    presets: [],
  },
];

export const round: RoundView = {
  id: 'd4n6p8r2t4v6x8z1k3b5c7d9',
  roomId: state.id,
  version: 1,
  status: 'scheduled',
  topic: state.topic,
  visibility: 'private',
  hostActorId: caller.actorId,
  config: oneOnOneFullConfig,
  rules: resolved.rules,
  participants: [
    {
      id: state.participants[0]!.id,
      actorId: caller.actorId,
      kind: 'human',
      label: 'Member',
      role: 'affirmative',
      slot: 0,
    },
  ],
  startedAt: null,
  completedAt: null,
  outcome: null,
};

export function makeOperations(overrides: Partial<Store> = {}) {
  let createInput: Parameters<Store['createRoomCommand']>[0] | null = null;
  const base = {
    databaseNow: async () => now,
    listRoomCatalogSources: async (
      _caller: typeof caller,
      authorize: (fact: AccountAuthorizationFact) => boolean,
    ) => {
      if (!authorize(account)) throw createAppError('AUTHORIZATION');
      return catalog;
    },
    listRoomBots: async (
      _caller: typeof caller,
      authorize: (fact: AccountAuthorizationFact) => boolean,
    ) => {
      if (!authorize(account)) throw createAppError('AUTHORIZATION');
      return [
        {
          id: 'b4n6p8r2t4v6x8z1k3b5c7d9',
          actorId: 'b4n6p8r2t4v6x8z1k3b5c7d9',
          kind: 'bot' as const,
          label: 'Practice bot',
          eligible: true,
          persona: 'A practice opponent',
          voice: 'neutral',
          difficulty: 'beginner' as const,
        },
        {
          id: 'h4n6p8r2t4v6x8z1k3b5c7d9',
          actorId: 'h4n6p8r2t4v6x8z1k3b5c7d9',
          kind: 'human' as const,
          label: 'Not a cast choice',
          eligible: true,
          persona: null,
          voice: null,
          difficulty: null,
        },
      ];
    },
    getFormatRevision: async () => null,
    getCurrentPreset: async () => null,
    readRoomCreateReceipt: async (input: {
      readonly caller: typeof caller;
      readonly commandId: string;
      readonly payloadDigest: string;
      readonly authorize: (fact: AccountAuthorizationFact) => boolean;
    }) => {
      if (!input.authorize(account)) throw createAppError('AUTHORIZATION');
      return null;
    },
    createRoomCommand: async (
      input: Parameters<Store['createRoomCommand']>[0],
    ) => {
      createInput = input;
      if (!input.authorize(account)) throw createAppError('AUTHORIZATION');
      return {
        commandId: input.commandId,
        roomId: state.id,
        resultingVersion: 1,
        roundRef: null,
        replayed: false,
      };
    },
    readRoomAssembly: async (
      _roomId: string,
      _caller: typeof caller,
      authorize: (
        view: RoomAssemblyState,
        fact: AccountAuthorizationFact,
      ) => boolean,
    ) => {
      if (!authorize(state, account)) throw createAppError('NOT_FOUND');
      return state;
    },
    listRoomAssemblies: async (
      _caller: typeof caller,
      authorize: (
        view: RoomAssemblyState,
        fact: AccountAuthorizationFact,
      ) => boolean,
      authorizeCollection: (fact: AccountAuthorizationFact) => boolean,
    ) => {
      if (!authorizeCollection(account)) throw createAppError('AUTHORIZATION');
      return authorize(state, account) ? [state] : [];
    },
    readLaunchedRound: async (
      _id: string,
      _caller: typeof caller,
      authorize: (view: RoundView, fact: AccountAuthorizationFact) => boolean,
    ) => {
      if (!authorize(round, account)) throw createAppError('NOT_FOUND');
      return round;
    },
    executeRoomCommand: async () => {
      throw new Error(
        'Command execution is outside this operation contract test',
      );
    },
    ...overrides,
  } as unknown as Store;
  const operations = createRoomRuntimeOperations({
    store: base,
    redis: {
      setRoomConsent: async () => undefined,
      readRoomConsent: async () => [caller.actorId],
    } as never,
    ids: fixedIds([
      'c5n6p8r2t4v6x8z1k3b5c7d9',
      'r5n6p8r2t4v6x8z1k3b5c7d9',
      'f5n6p8r2t4v6x8z1k3b5c7d9',
    ]),
    maxOpenRooms: () => 5,
    consentTtlMs: () => 60_000,
    botsAvailable: () => false,
  });
  return {
    operations,
    store: base,
    createInput: () => createInput,
  };
}
