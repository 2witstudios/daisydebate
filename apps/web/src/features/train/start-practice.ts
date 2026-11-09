import type {
  PublishedResolution,
  RoomCatalogChoice,
  RoomCastChoice,
  RoomCreate,
} from '@daisy/protocol';
import { field, refused, type FormState } from '../forms/form-state';
import { aiJudgePremiumText } from '../rooms/ai-judge-copy';
import { casualSelection } from '../rooms/format-browser';
import {
  readRoomCreateAnswer,
  type RoomCreateRefusal,
} from '../rooms/room-create-response';
import { opponents, practiceJudge } from './bots';

/** What the practice form needs from the one catalog read. */
export type PracticeCatalog = {
  readonly bots: readonly RoomCastChoice[];
  /** The member may seat an AI judge on this casual Round (WATCH-16). */
  readonly botDebateAiJudge: boolean;
  /** The standards a practice may run: Freestyle, Policy and Value, catalog order. */
  readonly formats: readonly RoomCatalogChoice[];
  /** The published resolutions a fixed-resolution practice names. */
  readonly resolutions: readonly PublishedResolution[];
};

export type PracticeRequest =
  | { readonly kind: 'refused'; readonly error: string }
  | {
      readonly kind: 'ready';
      /** The create the practice posts, one command, one rejection boundary. */
      readonly body: RoomCreate;
    };

const formatUnavailable =
  'Practice in that format is unavailable right now. Choose another.';

/**
 * The create a Start practice post asks for (DEC-269): a casual Room in the
 * addressed standard — Freestyle strikes its resolution; Policy and Value
 * debate their current publication — with the chosen bot at negative. The AI
 * judge judges for a member holding the casual AI judge entitlement
 * (WATCH-16); otherwise the judge seat stays open for a person the host
 * invites from the Room. The host claims a side in the Room.
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
  const format = catalog.formats.find(
    (choice) => choice.formatId === (field(form, 'format') || 'freestyle'),
  );
  if (!format) return { kind: 'refused', error: formatUnavailable };
  const publication = catalog.resolutions.find(
    (resolution) => resolution.kind === format.formatId,
  );
  let resolution: RoomCreate['resolution'] = { kind: 'strike' };
  if (format.formatId !== 'freestyle') {
    if (
      (format.formatId !== 'policy' && format.formatId !== 'value') ||
      !publication
    )
      return { kind: 'refused', error: formatUnavailable };
    resolution = { kind: format.formatId, id: publication.id };
  }
  return {
    kind: 'ready',
    body: {
      commandId,
      title: `Practice vs ${bot.label}`,
      resolution,
      visibility: 'public',
      selection: casualSelection(format),
      cast: [
        { actorId: bot.actorId, role: 'negative', slot: 0 },
        ...(judge
          ? [{ actorId: judge.actorId, role: 'judge' as const, slot: 0 }]
          : []),
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
): Promise<FormState> {
  const answer = await readRoomCreateAnswer(response);
  switch (answer.kind) {
    case 'created':
      return { values: {}, next: `/rooms/${answer.roomId}` };
    case 'active-room':
      return { values: {}, next: answer.href ?? '/lobby' };
    case 'refused':
      return refused(form, refusalLines[answer.reason]);
    case 'unavailable':
      return refused(form, 'Practice is unavailable. Try again.');
  }
}
