import { mockOpponent } from '../../ui/mock/train-practice';

/**
 * The AI opponent behind its sandbox seat (ADR 0030). No AI service exists
 * yet, so this is an adapter seam: a request for the opponent's next speech
 * that can answer or be unavailable. The real adapter replaces `opponentSpeech`
 * and nothing else imports the mock.
 */
type OpponentRequest = {
  readonly motion: string;
  /** Which of the opponent's own speeches this is, from zero. */
  readonly ordinal: number;
};

type OpponentReply =
  { readonly ok: true; readonly text: string } | { readonly ok: false };

export type OpponentAdapter = (request: OpponentRequest) => OpponentReply;

export const opponentSpeech: OpponentAdapter = mockOpponent;
