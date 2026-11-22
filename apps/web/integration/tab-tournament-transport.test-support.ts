import { idSchema } from '@daisy/protocol/primitives';
import {
  lobbyCommandReceiptSchema,
  type LobbyCommandAnswer,
} from '@daisy/protocol/lobby/command';
import { z } from 'zod';
import type { TabPrincipal } from '../src/features/tab/tab-principal';
import { directTournamentCommands } from './tab-tournament-direct.test-support';
import type { World } from './tab-tournament.test-support';

type Caller = { readonly userId: string };
type Query = Record<string, string>;

export type TournamentHttp = (
  caller: Caller,
  path: string,
  body?: unknown,
) => Promise<Response>;

export class TournamentHttpError extends Error {
  constructor(
    readonly status: number,
    path: string,
    detail: string,
  ) {
    super(`${path}: HTTP ${status} ${detail}`);
  }
}

const commandAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('accepted'),
    receipt: lobbyCommandReceiptSchema,
  }),
  z.strictObject({
    kind: z.literal('pending'),
    pendingCommandId: idSchema,
    expiresAt: z.string(),
  }),
  z.strictObject({
    kind: z.literal('settled'),
    pendingCommandId: idSchema,
    status: z.enum(['declined', 'withdrawn', 'lapsed']),
    expiresAt: z.string(),
  }),
  z.strictObject({
    kind: z.literal('refused'),
    refusal: z.string(),
    people: z.array(idSchema).optional(),
  }),
]);

type Command<Args extends unknown[]> = (
  ...args: Args
) => Promise<LobbyCommandAnswer>;
type CommandRequest = {
  readonly query?: Query;
  readonly body: unknown;
};

const routePath = (route: string, query?: Query) =>
  `/api/tab/${route}${query ? `?${new URLSearchParams(query)}` : ''}`;

async function requireSuccess(response: Response, path: string) {
  if (!response.ok)
    throw new TournamentHttpError(response.status, path, await response.text());
  return response.json();
}

function commandRoute<Args extends unknown[]>(
  world: World,
  route: string,
  direct: () => Command<[TabPrincipal, ...Args]>,
  request: (...args: Args) => CommandRequest,
): Command<[TabPrincipal, ...Args]> {
  const http = world.http;
  if (!http) return direct();
  return async (actor, ...args) => {
    const { query, body } = request(...args);
    const path = routePath(`${route}-command`, query);
    const answer = commandAnswerSchema.parse(
      await requireSuccess(await http(actor, path, body), path),
    );
    if (answer.kind !== 'refused') return answer;
    return {
      kind: answer.kind,
      refusal: answer.refusal,
      ...(answer.people === undefined ? {} : { people: answer.people }),
    };
  };
}

const commands = {
  lobbyAdministration: 'lobby',
  setup: 'lobby',
  organization: 'organization',
  settings: 'settings',
} as const;

export const tabCommand = (world: World, command: keyof typeof commands) =>
  commandRoute(
    world,
    commands[command],
    () => directTournamentCommands(world)[command],
    (body: unknown) => ({ body }),
  );

const lobbyCommands = {
  confirmation: 'confirmation',
  draw: 'draw',
  entries: 'entries',
  fixture: 'fixture',
  judges: 'judges',
  fixtureResult: 'result',
  eventResult: 'result',
  completion: 'result',
} as const;

export const tabLobbyCommand = (
  world: World,
  command: keyof typeof lobbyCommands,
) =>
  commandRoute(
    world,
    lobbyCommands[command],
    () => directTournamentCommands(world)[command],
    (lobbyId: string, body: unknown) => ({ query: { lobbyId }, body }),
  );

export const tabSanctionCommand = (world: World) =>
  commandRoute(
    world,
    'sanction',
    () => directTournamentCommands(world).sanction,
    (
      scope: { readonly organizationId: string; readonly lobbyId: string },
      envelope: unknown,
    ) => ({ body: { ...scope, envelope } }),
  );

export async function readTab<T>(
  http: TournamentHttp,
  caller: Caller,
  route: string,
  query: Query,
  schema: { parse(value: unknown): T },
): Promise<T | null> {
  const path = routePath(route, query);
  const response = await http(caller, path);
  return response.status === 404
    ? null
    : schema.parse(await requireSuccess(response, path));
}

export function tabRead<Actor extends Caller, Input, Output>(
  world: World,
  route: string,
  schema: { parse(value: unknown): Output },
  direct: (actor: Actor, input: Input) => Promise<Output | null>,
  query: (input: Input) => Query,
) {
  const http = world.http;
  return http
    ? (actor: Actor, input: Input) =>
        readTab(http, actor, route, query(input), schema)
    : direct;
}
