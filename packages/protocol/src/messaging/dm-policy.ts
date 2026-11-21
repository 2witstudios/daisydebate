import type { AgeBand } from '../ladder';
import type { ProtectionLimits } from '../protection-level';
import type { MessageRequestSetting } from './social';

export type DmRequestAction = 'message' | 'befriend' | 'none';

/**
 * One question to the DM rule (decision 90). `request` opens a new message
 * request; `conversation` is everything on an existing DM (accepting it,
 * posting, typing), whose initiator is the request's sender.
 */
export type DmQuestion = {
  readonly stage: 'request' | 'conversation';
  readonly initiator: AgeBand;
  readonly recipient: AgeBand;
  /** The pair is an accepted friendship. */
  readonly friends: boolean;
  /** The initiator is one of the recipient's linked adults (ADR 0158). */
  readonly linkedStaff: boolean;
  /** The recipient's own choice; read only for a new request. */
  readonly recipientSetting: MessageRequestSetting;
  readonly protectedMessageRequests?: ProtectionLimits['messageRequests'];
};

/**
 * Decision 90, DMs like Discord: any member 13 or over may DM any other
 * through a message request, under the recipient's request setting. An
 * adult's first contact with a minor is a friendship, so an adult may ask a
 * minor, or keep posting to one, only while they are friends or the adult is
 * the minor's own linked staff. A minor may always ask an adult. Total: every
 * question has one answer, and an under-13 party is always refused.
 */
export function dmAllowed(question: DmQuestion): boolean {
  const { initiator, recipient, friends, linkedStaff } = question;
  if (initiator === 'under-13' || recipient === 'under-13') return false;
  if (question.stage === 'request') {
    const setting =
      question.protectedMessageRequests ?? question.recipientSetting;
    if (setting === 'none' || (setting === 'friends' && !friends)) return false;
  }
  const adultToMinor = initiator === 'adult' && recipient !== 'adult';
  return !adultToMinor || friends || linkedStaff;
}

/** Show Add friend only if an accepted friendship would allow the request. */
export function dmRequestAction(
  question: Omit<DmQuestion, 'stage'>,
): DmRequestAction {
  if (dmAllowed({ ...question, stage: 'request' })) return 'message';
  return !question.friends &&
    dmAllowed({ ...question, stage: 'request', friends: true })
    ? 'befriend'
    : 'none';
}
