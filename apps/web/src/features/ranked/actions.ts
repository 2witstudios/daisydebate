/**
 * Where Ranked's actions go. There is no backend yet, so matchmaking moves
 * through the mock flow (`match-flow.ts`) by plain links and nothing is
 * mutated. The real operations (request a match, answer an offer, post a
 * table) replace these destinations and the one inert control here, and
 * nothing else.
 */
export const rankedDestinations = {
  /** Where "Enter room" leads: the room page does not exist yet. */
  room: '/play',
  /** Posted tables and casual hosting both live in the lobby. */
  lobby: '/lobby',
  hostTable: '/ranked/host',
  ranked: '/ranked',
} as const;

/**
 * The optional table name cannot be kept: naming a table is part of the room
 * the backend will create, and a typed name must never ride in a URL
 * (ui-conventions, mutating forms), so the field stays disabled for now.
 */
export const tableNameInert = {
  reason: 'Naming a table arrives with hosting.',
} as const;
