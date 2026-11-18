import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { lobbyCommandReceiptSchema } from '@daisy/protocol/lobby/command';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import { settingCommandEnvelopeSchema } from '@daisy/protocol/lobby/setting-command';
import type { RatingDivision } from '@daisy/protocol';
import {
  field,
  idle,
  refusedWith,
  unacknowledged,
  type Idle,
  type Moved,
  type Refused,
  type Unacknowledged,
} from '../forms/form-state';

/** Ids minted when the form renders, so a resent form makes one tournament. */
export const createTournamentContextSchema = z.strictObject({
  lobbyCommandId: idSchema,
  eventCommandId: idSchema,
  divisionCommandId: idSchema,
  /** Lower-case letters and digits that make the handle unique. */
  suffix: z.string().regex(/^[a-z0-9]{6}$/),
});
export type CreateTournamentContext = z.infer<
  typeof createTournamentContextSchema
>;
export type CreateTournamentState = Idle | Refused | Unacknowledged | Moved;
export const initialCreateTournament: CreateTournamentState = idle({
  name: '',
  division: 'open',
});
export const createTournamentUnacknowledged = (
  form: FormData,
): CreateTournamentState => unacknowledged(form);
export const createTournamentRefused = (
  form: FormData,
  error: string,
): CreateTournamentState =>
  refusedWith(
    { name: field(form, 'name'), division: field(form, 'division') },
    error,
  );

/** "Friday Scrimmage!" → "friday-scrimmage-k3x9q2": readable, unique, within 48. */
export const tournamentHandle = (name: string, suffix: string) => {
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return words.length >= 2 ? `${words}-${suffix}` : `tournament-${suffix}`;
};

const nameOf = (form: FormData) => {
  const values = form.getAll('name');
  if (values.length !== 1 || typeof values[0] !== 'string') return null;
  const name = values[0].trim();
  return name.length >= 1 && name.length <= 120 ? name : null;
};

const divisionOf = (form: FormData): RatingDivision | null => {
  const values = form.getAll('division');
  return values.length === 1 && (values[0] === 'open' || values[0] === 'youth')
    ? values[0]
    : null;
};

/** The tournament the form makes: the host owns it; it admits no minors. */
export function createTournamentEnvelope(
  untrusted: CreateTournamentContext,
  form: FormData,
) {
  const context = createTournamentContextSchema.parse(untrusted);
  const name = nameOf(form);
  const division = divisionOf(form);
  if (name === null || division === null) return null;
  const handle = tournamentHandle(name, context.suffix);
  return {
    handle,
    division,
    envelope: lobbySetupCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.lobbyCommandId,
      expected: {},
      command: {
        type: 'create-lobby',
        owner: { kind: 'self' },
        name,
        handle,
        lobby: { kind: 'tournament', admitsMinors: false },
      },
    }),
  };
}

/**
 * Its division (PYL-16), set on the new lobby, whose settings start at
 * version 1. Open is the default and needs no row.
 */
export const divisionSettingEnvelope = (
  context: CreateTournamentContext,
  lobbyId: string,
) =>
  settingCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.divisionCommandId,
    expected: { settings: 1 },
    command: {
      type: 'set-setting',
      scope: { kind: 'lobby', id: lobbyId },
      key: 'entry.age_division',
      value: { value: 'youth' },
      hold: 'default',
    },
  });

/** Its one event: Freestyle, the only style today. */
export const freestyleEventEnvelope = (
  context: CreateTournamentContext,
  lobbyId: string,
  lobbyVersion: number,
) =>
  lobbySetupCommandEnvelopeSchema.parse({
    version: 1,
    commandId: context.eventCommandId,
    expected: { lobby: lobbyVersion },
    command: {
      type: 'add-event',
      lobbyId,
      name: 'Freestyle',
      label: 'FS',
      entry: { kind: 'person' },
      pin: {
        kind: 'format',
        formatId: 'freestyle',
        formatVersion: 1,
        ballotDefinition: null,
      },
    },
  });

const answerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('accepted'), receipt: lobbyCommandReceiptSchema }),
  z.object({ kind: z.literal('refused'), refusal: z.string() }),
]);

/** A command's answer: its receipt, or the sentence the form shows. */
export const createTournamentAnswer = (
  form: FormData,
  body: unknown,
):
  | {
      readonly kind: 'accepted';
      readonly lobbyId: string;
      readonly version: number;
    }
  | CreateTournamentState => {
  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return createTournamentUnacknowledged(form);
  if (parsed.data.kind === 'accepted')
    return {
      kind: 'accepted',
      lobbyId: parsed.data.receipt.aggregate.id,
      version: parsed.data.receipt.resultingVersion,
    };
  return createTournamentRefused(
    form,
    parsed.data.refusal === 'handle-taken'
      ? 'That name is taken. Try another.'
      : 'This tournament could not be made. Reload this page.',
  );
};
