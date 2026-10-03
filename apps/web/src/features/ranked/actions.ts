/**
 * Where Ranked's actions go. There is no backend yet, so matchmaking moves
 * through the mock flow (`match-flow.ts`) by plain links and nothing is
 * mutated. The real operations (request a match, answer an offer, post a
 * table) replace these destinations and the one inert control here, and
 * nothing else.
 */
export const rankedDestinations = {
  /** Where "Enter room" leads: the ranked room. */
  room: '/rooms/room-tuesday-night',
  /** Posted tables and casual hosting both live in the lobby. */
  lobby: '/lobby',
  hostTable: '/ranked/host',
  ranked: '/ranked',
} as const;
