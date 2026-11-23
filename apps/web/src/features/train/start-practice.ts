import { judgeSeat, sideSeat } from '@daisy/protocol/seats';
import {
  type RoomCatalogChoice,
  type RoomCastChoice,
  type RoomCreate,
} from '@daisy/protocol/room-contract';
import {
  field,
  moved,
  refused,
  type Moved,
  type Refused,
} from '../forms/form-state';
import { aiJudgePremiumText } from '../rooms/ai-judge-copy';
import { casualSelection } from '../rooms/format-browser';
import {
  readRoomCreateAnswer,
  type RoomCreateRefusal,
} from '../rooms/room-create-response';
import { defaultRoomVisibility } from '../rooms/room-visibility';
import { opponents, practiceJudge } from './bots';

/** What the practice form needs from the one catalog read. */
export type PracticeCatalog = {
  readonly bots: readonly RoomCastChoice[];
  /** The member may seat an AI judge on this casual Round (WATCH-16). */
  readonly botDebateAiJudge: boolean;
  /** The catalog's format choices; a practice runs its Freestyle standard. */
  readonly choices: readonly RoomCatalogChoice[];
};

export type PracticeRequest =
  | { readonly kind: 'refused'; readonly error: string }
  | {
      readonly kind: 'ready';
      /** The create the practice posts, one command, one rejection boundary. */
      readonly body: RoomCreate;
    };

const practiceUnavailable = 'Practice is unavailable. Try again.';

/** Daisy's one standard as the catalog offers it, or null when it is absent. */
const freestyleOf = (
  choices: readonly RoomCatalogChoice[],
): RoomCatalogChoice | null =>
  choices.find(
    (choice) => choice.role === 'standard' && choice.formatId === 'freestyle',
  ) ?? null;

/**
 * The create a Start practice post asks for (DEC-269): a casual Freestyle
 * Room, its resolution struck from the five Daisy draws, with the chosen bot
 * on the last declared side. The AI judge judges for a member holding the
 * casual AI judge entitlement (WATCH-16); otherwise the judge seat stays open
 * for a person the host invites from the Room. The host claims a side in the
 * Room.
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
  const judge = catalog.botDebateAiJudge ? practiceJudge(catalog.bots) : null;
  if (catalog.botDebateAiJudge && !judge)
    return {
      kind: 'refused',
      error: 'The AI judge is unavailable, so a practice room can’t assemble.',
    };
  const freestyle = freestyleOf(catalog.choices);
  if (!freestyle) return { kind: 'refused', error: practiceUnavailable };
  // The bot takes the last declared side, so the member opens the round.
  const botSide = freestyle.definition.sides.at(-1);
  if (!botSide) return { kind: 'refused', error: practiceUnavailable };
  return {
    kind: 'ready',
    body: {
      commandId,
      title: `Practice vs ${bot.label}`,
      resolution: { kind: 'strike' },
      visibility: defaultRoomVisibility,
      selection: casualSelection(freestyle),
      // The bot takes a seat, not a side: practice flips for sides like any Room (ADR 0145).
      sides: 'open',
      // Its creator is held from create: a second Start practice returns here.
      practice: true,
      cast: [
        { actorId: bot.actorId, seat: sideSeat(botSide.key) },
        ...(judge ? [{ actorId: judge.actorId, seat: judgeSeat() }] : []),
      ],
    },
  };
}

const refusalLines: Readonly<Record<RoomCreateRefusal, string>> = {
  forbidden: 'Your account can’t start rooms right now.',
  'rate-limited': 'You’re starting rooms too quickly. Wait a moment.',
  replayed: 'This form was already sent. Reload the page and try again.',
  'actor-ineligible':
    'That opponent can’t start a practice right now. Pick another.',
  'seat-unavailable': 'Someone took that seat first. Start again.',
  'bot-debates-coming-soon': 'Bot debates are coming soon.',
  settings: 'Practice couldn’t start. Try again.',
  'ranked-unavailable': 'Practice couldn’t start. Try again.',
  'ai-judge-premium': aiJudgePremiumText,
  'capture-premium': 'Practice couldn’t start. Try again.',
  // Practice is casual and states no notice, so nothing reaches a person here.
  'notice-changed': 'Practice couldn’t start. Try again.',
};

/**
 * The authenticated create's answer, in the room form's own words: created
 * moves on to the Room, an existing Room takes the member back (ADR 0070),
 * and every refusal says what to do next.
 */
export async function practiceAnswer(
  response: Response,
  form: FormData,
): Promise<Refused | Moved> {
  const answer = await readRoomCreateAnswer(response);
  switch (answer.kind) {
    case 'created':
      return moved(`/rooms/${answer.roomId}`);
    case 'active-room':
      return moved(answer.href ?? '/lobby');
    case 'refused':
      return refused(form, refusalLines[answer.reason]);
    case 'unavailable':
      return refused(form, 'Practice is unavailable. Try again.');
  }
}
