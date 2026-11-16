import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { organizationCommandEnvelopeSchema } from '@daisy/protocol/lobby/organization-command';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import { singleFormField } from '../../server/form-field';
import {
  field,
  idle,
  refusedWith,
  type Idle,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';

export type PeopleCommandContext = {
  readonly organizationId: string;
  readonly organizationVersion: number;
  readonly lobbies: readonly {
    readonly lobbyId: string;
    readonly version: number;
  }[];
  readonly commandId: string;
  readonly handle: string;
} & (
  | { readonly intent: 'give' }
  | {
      readonly intent: 'cancel';
      readonly userId: string;
      readonly membershipVersion: number;
    }
  | {
      readonly intent: 'remove';
      readonly grants: readonly {
        readonly grantId: string;
        readonly scope:
          | { readonly kind: 'organization' }
          | { readonly kind: 'lobby'; readonly lobbyId: string };
      }[];
    }
);
export type PeopleCommandValues = {
  readonly userId: string;
  readonly roleId: string;
  readonly scope: string;
  readonly expiresAt: string;
  readonly grantId: string;
};
export type PeopleCommandState =
  | ((Idle | Refused | Unacknowledged) & {
      readonly values: PeopleCommandValues;
    })
  | { readonly kind: 'changed'; readonly notice: string };
const empty: PeopleCommandValues = {
  userId: '',
  roleId: '',
  scope: 'organization',
  expiresAt: '',
  grantId: '',
};
export const initialPeopleCommand = (): PeopleCommandState => idle(empty);
export const peopleCommandValues = (form: FormData): PeopleCommandValues => ({
  userId: field(form, 'userId'),
  roleId: field(form, 'roleId'),
  scope: field(form, 'scope') || 'organization',
  expiresAt: field(form, 'expiresAt'),
  grantId: field(form, 'grantId'),
});
export const peopleCommandRefused = (
  values: PeopleCommandValues,
  error: string,
): PeopleCommandState => refusedWith(values, error);
export const peopleCommandUnacknowledged = (
  values: PeopleCommandValues,
): PeopleCommandState => ({ kind: 'unacknowledged', values });
const expiry = (value: string): string | null => {
  if (value === '') return null;
  const local = z.iso.datetime({ local: true, precision: -1 }).parse(value);
  return `${local}:00Z`;
};
/** Retain the addressed aggregate's guard from the snapshot the host saw. */
export const peopleCommandEnvelope = (
  context: PeopleCommandContext,
  form: FormData,
) => {
  if (context.intent === 'cancel')
    return organizationCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.commandId,
      expected: { membership: context.membershipVersion },
      command: {
        type: 'cancel-membership-invitation',
        organizationId: context.organizationId,
        userId: context.userId,
      },
    });
  const chosenGrant =
    context.intent === 'remove'
      ? context.grants.find(
          (grant) => grant.grantId === singleFormField(form, 'grantId'),
        )
      : null;
  if (context.intent === 'remove' && !chosenGrant)
    throw createAppError('VALIDATION');
  const choice =
    context.intent === 'give'
      ? singleFormField(form, 'scope')
      : chosenGrant?.scope.kind === 'lobby'
        ? chosenGrant.scope.lobbyId
        : 'organization';
  const lobby =
    choice === 'organization'
      ? null
      : context.lobbies.find((one) => one.lobbyId === choice);
  if (choice !== 'organization' && !lobby) throw createAppError('VALIDATION');
  const scope = lobby
    ? { kind: 'lobby', lobbyId: lobby.lobbyId }
    : { kind: 'organization', organizationId: context.organizationId };
  const command =
    context.intent === 'give'
      ? {
          type: 'give-grant',
          userId: singleFormField(form, 'userId'),
          roleId: singleFormField(form, 'roleId'),
          scope,
          expiresAt: expiry(singleFormField(form, 'expiresAt')),
        }
      : {
          type: 'remove-grant',
          scope,
          grantId: singleFormField(form, 'grantId'),
        };
  return organizationCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.commandId,
    expected: lobby
      ? { lobby: lobby.version }
      : { organization: context.organizationVersion },
    command,
  });
};
const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), receipt: lobbyCommandReceiptSchema }),
  z.object({ kind: z.literal('refused'), refusal: z.string() }),
  z.object({
    kind: z.literal('pending'),
    pendingCommandId: z.string(),
    expiresAt: z.string(),
  }),
]);
const refusalWords: Readonly<Record<string, string>> = {
  'version-conflict': 'People changed. Reload this page before trying again.',
  'already-granted': 'That person already holds this role here.',
  'not-a-member': 'Choose an active member of this organization.',
  'expiry-passed': 'Choose an expiry in the future.',
  'role-not-below': 'Choose a role below your own.',
  'permission-not-held':
    'You cannot give a role with permissions you do not hold.',
  'scope-not-covered': 'You cannot give that role at this scope.',
  'age-band': 'This role is not available for that member.',
  'grant-ended': 'That role has already ended. Reload this page.',
  'command-conflict':
    'This action conflicts with an earlier request. Reload this page.',
};
export const peopleCommandAnswered = (
  context: PeopleCommandContext,
  values: PeopleCommandValues,
  body: unknown,
): PeopleCommandState => {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return peopleCommandUnacknowledged(values);
  if (parsed.data.kind === 'accepted')
    return {
      kind: 'changed',
      notice:
        context.intent === 'give'
          ? 'Role given.'
          : context.intent === 'cancel'
            ? 'Invitation cancelled.'
            : 'Role ended.',
    };
  return peopleCommandRefused(
    values,
    parsed.data.kind === 'refused'
      ? (refusalWords[parsed.data.refusal] ??
          'This change could not be made. Reload this page.')
      : 'This change is waiting for confirmation.',
  );
};
export const peopleCommandFields = (state: PeopleCommandState) => {
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
