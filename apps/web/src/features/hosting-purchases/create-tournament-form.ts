import { mapTabCommandAnswer } from '../tab/command-form-answer';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import {
  lobbyAgeRules,
  type LobbyAgeRule,
} from '@daisy/protocol/lobby/eligibility';
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
const createTournamentContextSchema = z.strictObject({
  lobbyCommandId: idSchema,
  eventCommandId: idSchema,
  leagueId: idSchema.optional(),
  /** Lower-case letters and digits that make the handle unique. */
  suffix: z.string().regex(/^[a-z0-9]{6}$/),
});
export type CreateTournamentContext = z.infer<
  typeof createTournamentContextSchema
>;
export type CreateTournamentState = Idle | Refused | Unacknowledged | Moved;
export const initialCreateTournament: CreateTournamentState = idle({
  name: '',
  ageRule: 'adults',
});
export const createTournamentUnacknowledged = (
  form: FormData,
): CreateTournamentState => unacknowledged(form);
export const createTournamentRefused = (
  form: FormData,
  error: string,
): CreateTournamentState =>
  refusedWith(
    {
      name: field(form, 'name'),
      ...(form.has('standingLobbyId')
        ? { standingLobbyId: field(form, 'standingLobbyId') }
        : { ageRule: field(form, 'ageRule') }),
    },
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

const ageRuleOf = (form: FormData): LobbyAgeRule | null => {
  const values = form.getAll('ageRule');
  if (values.length !== 1) return null;
  const parsed = z.enum(lobbyAgeRules).safeParse(values[0]);
  return parsed.success ? parsed.data : null;
};

const personalEligibilityOf = (form: FormData) => {
  const ageRule = ageRuleOf(form);
  return ageRule === null ? null : { kind: 'own' as const, ageRule };
};

const standingEligibilityOf = (form: FormData) => {
  const selected = form.getAll('standingLobbyId');
  if (selected.length !== 1) return null;
  const lobbyId = idSchema.safeParse(selected[0]);
  return lobbyId.success
    ? { kind: 'standing' as const, lobbyId: lobbyId.data }
    : null;
};

/** The league selects a standing lobby. A self-run tournament declares its age rule. */
export function createTournamentEnvelope(
  untrusted: CreateTournamentContext,
  form: FormData,
) {
  const context = createTournamentContextSchema.parse(untrusted);
  const name = nameOf(form);
  if (name === null) return null;
  const eligibility = context.leagueId
    ? standingEligibilityOf(form)
    : personalEligibilityOf(form);
  if (eligibility === null) return null;
  const handle = tournamentHandle(name, context.suffix);
  return {
    handle,
    envelope: lobbySetupCommandEnvelopeSchema.parse({
      version: 1,
      commandId: context.lobbyCommandId,
      expected: {},
      command: {
        type: 'create-lobby',
        owner: context.leagueId
          ? { kind: 'organization', organizationId: context.leagueId }
          : { kind: 'self' },
        name,
        handle,
        lobby: { kind: 'tournament', eligibility },
      },
    }),
  };
}

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
  return mapTabCommandAnswer(body, {
    accepted: (receipt) => ({
      kind: 'accepted' as const,
      lobbyId: receipt.aggregate.id,
      version: receipt.resultingVersion,
    }),
    unacknowledged: () => createTournamentUnacknowledged(form),
    refused: (reason) =>
      createTournamentRefused(
        form,
        reason === 'handle-taken'
          ? 'That name is taken. Try another.'
          : reason === 'standing-lobby-required'
            ? 'Choose an open standing lobby from this league.'
            : 'This tournament could not be made. Reload this page.',
      ),
  });
};

/** A command post as the form sees it: the receipt's facts, or the form's answer. */
type CommandAnswer =
  | {
      readonly kind: 'accepted';
      readonly lobbyId: string;
      readonly version: number;
    }
  | CreateTournamentState;

/** The form creates the tournament, then its Freestyle event. Retries reuse the command ids. */
export async function runCreateTournament(
  ports: {
    readonly lobbyCommand: (envelope: unknown) => Promise<CommandAnswer>;
  },
  context: CreateTournamentContext,
  form: FormData,
): Promise<
  { readonly kind: 'made'; readonly handle: string } | CreateTournamentState
> {
  let made;
  try {
    made = createTournamentEnvelope(context, form);
  } catch {
    return createTournamentRefused(form, 'Reload this page and try again.');
  }
  if (made === null)
    return createTournamentRefused(
      form,
      'Enter a name and select the tournament’s eligibility.',
    );
  try {
    const lobby = await ports.lobbyCommand(made.envelope);
    if (lobby.kind !== 'accepted') return lobby;
    // The tournament exists either way; Setup lets the host add the event.
    await ports.lobbyCommand(
      freestyleEventEnvelope(context, lobby.lobbyId, lobby.version),
    );
  } catch {
    return createTournamentUnacknowledged(form);
  }
  return { kind: 'made', handle: made.handle };
}
