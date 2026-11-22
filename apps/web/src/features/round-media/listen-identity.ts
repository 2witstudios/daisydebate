import { sha3Hex } from '@daisy/digest';
/**
 * The bot seat's listen-only identity: a pure function of the seat's own
 * media identity, so every grant for one seat, from any instance, names the
 * same participant, and a new connection evicts an older (possibly wedged)
 * one. It is a valid participant id and never equals a seat's identity.
 */
export const listenIdentity = (seatIdentity: string) =>
  sha3Hex(`bot-listener:${seatIdentity}`).slice(0, 24);
