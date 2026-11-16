import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { parseUsername } from '@daisy/protocol';
import { organizationCommandEnvelopeSchema } from '@daisy/protocol/lobby/organization-command';
import { singleFormField } from '../../server/form-field';
import {
  field,
  idle,
  refusedWith,
  type Idle,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';
import { peopleCommandResult } from './people-command-result';

export type LobbyPeopleCommandContext = {
  readonly lobbyId: string;
  readonly lobbyVersion: number;
  readonly commandId: string;
  readonly handle: string;
} & (
  | { readonly intent: 'give'; readonly roles: readonly string[] }
  | { readonly intent: 'remove'; readonly grants: readonly string[] }
);
export type LobbyPeopleCommandValues = {
  readonly username: string;
  readonly roleId: string;
  readonly expiresAt: string;
  readonly grantId: string;
};
export type LobbyPeopleCommandState =
  | ((Idle | Refused | Unacknowledged) & {
      readonly values: LobbyPeopleCommandValues;
    })
  | { readonly kind: 'changed'; readonly notice: string };
const empty: LobbyPeopleCommandValues = {
  username: '',
  roleId: '',
  expiresAt: '',
  grantId: '',
};
export const initialLobbyPeopleCommand = (): LobbyPeopleCommandState =>
  idle(empty);
export const lobbyPeopleCommandValues = (
  form: FormData,
): LobbyPeopleCommandValues => ({
  username: field(form, 'username'),
  roleId: field(form, 'roleId'),
  expiresAt: field(form, 'expiresAt'),
  grantId: field(form, 'grantId'),
});
export const lobbyPeopleCommandRefused = (
  values: LobbyPeopleCommandValues,
  error: string,
): LobbyPeopleCommandState => refusedWith(values, error);
export const lobbyPeopleCommandUnacknowledged = (
  values: LobbyPeopleCommandValues,
): LobbyPeopleCommandState => ({ kind: 'unacknowledged', values });
type LobbyPeopleIntent =
  | {
      readonly kind: 'give';
      readonly username: string;
      readonly roleId: string;
      readonly expiresAt: string | null;
    }
  | { readonly kind: 'remove'; readonly grantId: string };
/** Interpret only displayed role/grant identities; no posted field can change the lobby scope. */
export const lobbyPeopleCommandIntent = (
  context: LobbyPeopleCommandContext,
  form: FormData,
): LobbyPeopleIntent => {
  if (context.intent === 'remove') {
    const grantId = singleFormField(form, 'grantId');
    if (!context.grants.includes(grantId)) throw createAppError('VALIDATION');
    return { kind: 'remove', grantId };
  }
  const parsed = parseUsername(singleFormField(form, 'username'));
  const roleId = singleFormField(form, 'roleId');
  if (!parsed.ok || !context.roles.includes(roleId))
    throw createAppError('VALIDATION');
  const input = singleFormField(form, 'expiresAt');
  const expiresAt =
    input === ''
      ? null
      : `${z.iso.datetime({ local: true, precision: -1 }).parse(input)}:00Z`;
  return { kind: 'give', username: parsed.username, roleId, expiresAt };
};
export const lobbyPeopleCommandEnvelope = (
  context: LobbyPeopleCommandContext,
  intent: LobbyPeopleIntent,
  resolved: { readonly userId?: string } = {},
) => {
  if (context.intent !== intent.kind) throw createAppError('VALIDATION');
  return organizationCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: { lobby: context.lobbyVersion },
    command:
      intent.kind === 'give'
        ? {
            type: 'give-grant',
            scope: { kind: 'lobby', lobbyId: context.lobbyId },
            userId: resolved.userId,
            roleId: intent.roleId,
            expiresAt: intent.expiresAt,
          }
        : {
            type: 'remove-grant',
            scope: { kind: 'lobby', lobbyId: context.lobbyId },
            grantId: intent.grantId,
          },
  });
};
export const lobbyPeopleCommandAnswered = (
  intent: 'give' | 'remove',
  values: LobbyPeopleCommandValues,
  body: unknown,
): LobbyPeopleCommandState => {
  const answer = peopleCommandResult(intent, body);
  return answer.kind === 'changed' ? answer : { ...answer, values };
};
export const lobbyPeopleCommandFields = (state: LobbyPeopleCommandState) => {
  switch (state.kind) {
    case 'idle':
      return { values: state.values, error: null, notice: null };
    case 'refused':
      return { values: state.values, error: state.error, notice: null };
    case 'unacknowledged':
      return {
        values: state.values,
        error:
          'The answer was lost. Retry the same details to check whether it was saved.',
        notice: null,
      };
    case 'changed':
      return { values: empty, error: null, notice: state.notice };
  }
};
