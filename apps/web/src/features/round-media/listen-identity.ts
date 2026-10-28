/**
 * The bot seat's listen-only identity: a pure function of the seat's own
 * media identity, so every grant for one seat, from any instance, names the
 * same participant, and a new connection evicts an older (possibly wedged)
 * one. It is a valid participant id and never equals a seat's identity.
 */
export const listenIdentity = (seatIdentity: string) =>
  new Bun.CryptoHasher('sha3-256')
    .update(`bot-listener:${seatIdentity}`)
    .digest('hex')
    .slice(0, 24);
