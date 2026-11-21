import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import { z } from 'zod';
import { field, refuse, accept } from '../forms/form-state';
import type { Idle, Moved, Refused, Unacknowledged } from '../forms/form-state';

export type StandingLobbyFormState = Idle | Refused | Unacknowledged | Moved;

type Address = {
  readonly organizationId: string;
  readonly lobbyId: string;
};

export type StandingLobbyFormContext = {
  readonly commandId: string;
  readonly slug: string;
} & (
  | { readonly kind: 'new-lobby'; readonly organizationId: string }
  | (Address & { readonly kind: 'edit-lobby'; readonly lobbyVersion: number })
  | (Address & {
      readonly kind: 'ladder';
      readonly lobbyVersion: number;
      readonly ladderId: string | null;
    })
  | (Address & { readonly kind: 'open-season' })
  | (Address & {
      readonly kind: 'edit-season' | 'close-season';
      readonly seasonId: string;
      readonly seasonVersion: number;
    })
);

const day = z.iso.date();
const instant = (date: string) => `${date}T00:00:00.000Z`;
const handleOf = (name: string, commandId: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 22)
      .replace(/-$/, '') || 'lobby'
  }-${commandId}`;

export function standingLobbyFormBody(
  context: StandingLobbyFormContext,
  form: FormData,
  today: string,
) {
  const name = field(form, 'name');
  if (context.kind !== 'close-season' && (!name || name.length > 120))
    return refuse('Enter a name of up to 120 characters.');
  const address =
    'lobbyId' in context
      ? { lobbyId: context.lobbyId, organizationId: context.organizationId }
      : null;
  const starts = field(form, 'starts');
  const ends = field(form, 'ends');
  if (
    context.kind === 'open-season' &&
    (!day.safeParse(starts).success || starts > today)
  )
    return refuse('Choose a start date of today or earlier.');
  if (
    (context.kind === 'open-season' || context.kind === 'edit-season') &&
    ends &&
    !day.safeParse(ends).success
  )
    return refuse('Enter a valid end date.');
  if (context.kind === 'open-season' && ends && ends <= starts)
    return refuse('Choose an end date after the start date.');

  const endsAt = ends ? instant(ends) : null;
  const command = (() => {
    switch (context.kind) {
      case 'new-lobby':
        return {
          type: 'create-lobby',
          owner: {
            kind: 'organization',
            organizationId: context.organizationId,
          },
          name,
          handle: handleOf(name, context.commandId),
          lobby: { kind: 'standing', ageRule: field(form, 'ageRule') },
        };
      case 'edit-lobby':
        return {
          type: 'edit-standing-lobby',
          ...address,
          name,
          ageRule: field(form, 'ageRule'),
        };
      case 'ladder':
        return {
          type: 'save-ladder',
          ...address,
          name,
          ladderId: context.ladderId,
        };
      case 'open-season':
        return {
          type: 'create-season',
          ...address,
          name,
          startsAt: instant(starts),
          endsAt,
          counting: 'sanction',
          countsLobbyRooms: true,
          rule: {},
        };
      case 'edit-season':
        return {
          type: 'edit-season',
          ...address,
          seasonId: context.seasonId,
          name,
          endsAt,
        };
      case 'close-season':
        return { type: 'close-season', seasonId: context.seasonId };
    }
  })();
  const parsed = lobbySetupCommandEnvelopeSchema.safeParse({
    version: 1,
    commandId: context.commandId,
    expected:
      'lobbyVersion' in context
        ? { lobby: context.lobbyVersion }
        : 'seasonVersion' in context
          ? { season: context.seasonVersion }
          : {},
    command,
  });
  return parsed.success
    ? accept(parsed.data)
    : refuse('Check the details and try again.');
}

export const standingLobbyAnswerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), receipt: lobbyCommandReceiptSchema }),
  z.object({ kind: z.literal('refused'), refusal: z.string() }),
]);

const refusalMessages: Readonly<Record<string, string>> = {
  'version-conflict': 'These details changed. Reload this page before saving.',
  'season-open':
    'This lobby already has an active season. Close it before opening another.',
  'season-closed': 'This season is already closed.',
  'season-end-before-start': 'Choose an end date after the start date.',
  'command-conflict':
    'This form has already been submitted. Reload to check what was saved.',
};
export const standingLobbyRefusal = (refusal: string) =>
  Object.hasOwn(refusalMessages, refusal)
    ? refusalMessages[refusal]!
    : 'This change could not be made. Reload to check your access and the current details.';
