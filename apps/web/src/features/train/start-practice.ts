import type { RoomCastChoice, RoomCreate } from '@daisy/protocol';
import { field, refused, type FormState } from '../forms/form-state';
import { opponents, practiceJudge } from './bots';

/** What the practice form needs from the one catalog read. */
export type PracticeCatalog = {
  readonly bots: readonly RoomCastChoice[];
  readonly freestyle: {
    readonly formatId: 'freestyle';
    readonly formatVersion: number;
    readonly presetVersion: number;
  } | null;
};

export type PracticeRequest =
  | { readonly kind: 'refused'; readonly error: string }
  | {
      readonly kind: 'ready';
      /** The create the practice posts, one command, one rejection boundary. */
      readonly body: RoomCreate;
    };

/**
 * The create a Start practice post asks for (DEC-269): a casual Freestyle
 * Room whose resolution the pre-round strike draws, with the chosen bot at
 * negative and the AI judge judging. The host claims a side in the Room.
 */
export function preparePractice(
  form: FormData,
  catalog: PracticeCatalog,
  commandId: string,
): PracticeRequest {
  const botActorId = field(form, 'bot');
  const bot = opponents(catalog.bots).find(
    (candidate) => candidate.actorId === botActorId && candidate.eligible,
  );
  if (!bot)
    return {
      kind: 'refused',
      error: 'Choose an opponent to practise against.',
    };
  const judge = practiceJudge(catalog.bots);
  if (!judge)
    return {
      kind: 'refused',
      error: 'The AI judge is unavailable, so a practice room can’t assemble.',
    };
  if (!catalog.freestyle)
    return { kind: 'refused', error: 'Practice is unavailable. Try again.' };
  return {
    kind: 'ready',
    body: {
      commandId,
      title: `Practice vs ${bot.label}`,
      resolution: { kind: 'strike' },
      visibility: 'public',
      selection: {
        kind: 'catalog',
        formatId: catalog.freestyle.formatId,
        formatVersion: catalog.freestyle.formatVersion,
        presetVersion: catalog.freestyle.presetVersion,
        competitionType: 'casual',
      },
      cast: [
        { actorId: bot.actorId, role: 'negative', slot: 0 },
        { actorId: judge.actorId, role: 'judge', slot: 0 },
      ],
    },
  };
}

const createdSchema = {
  parse: (body: unknown): string | null => {
    const receipt = (body as { receipt?: { roomId?: string } })?.receipt;
    return typeof receipt?.roomId === 'string' ? receipt.roomId : null;
  },
};

/**
 * The authenticated create's answer, in the room form's own words: created
 * moves on to the Room, an existing Room takes the member back (ADR 0070),
 * and every refusal says what to do next.
 */
export async function practiceAnswer(
  response: Response,
  form: FormData,
): Promise<FormState> {
  if (response.ok) {
    const roomId = createdSchema.parse(await response.json().catch(() => null));
    return roomId
      ? { values: {}, next: `/rooms/${roomId}` }
      : refused(form, 'Practice is unavailable. Try again.');
  }
  const body = (await response.json().catch(() => null)) as {
    refusal?: string;
    activeRoom?: { href?: string | null } | null;
  } | null;
  if (response.status === 409 && body?.refusal === 'active-room')
    return { values: {}, next: body.activeRoom?.href ?? '/lobby' };
  const messages: Record<string, string> = {
    forbidden: 'Your account can’t start rooms right now.',
    'rate-limited': 'You’re starting rooms too quickly. Wait a moment.',
    replayed: 'This form was already sent. Reload the page and try again.',
    'actor-ineligible':
      'That opponent can’t start a practice right now. Pick another.',
    'seat-unavailable': 'Someone took that seat first. Start again.',
  };
  return refused(
    form,
    (body?.refusal && messages[body.refusal]) ??
      'Practice couldn’t start. Try again.',
  );
}
