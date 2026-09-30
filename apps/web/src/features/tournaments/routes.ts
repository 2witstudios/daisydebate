/**
 * Where tournament links go. Public pages live under /tournaments/[id];
 * everything that needs an account sits under /tournaments/enter, /mine or
 * /organize, the guarded areas in features/access/decision.ts.
 */
export const tournamentRoutes = {
  index: '/tournaments',
  detail: (id: string) => `/tournaments/${id}`,
  bracket: (id: string) => `/tournaments/${id}/bracket`,
  results: (id: string) => `/tournaments/${id}/results`,
  enter: (id: string) => `/tournaments/enter/${id}`,
  withdraw: (id: string) => `/tournaments/enter/${id}/withdraw`,
  myEvent: (id: string) => `/tournaments/mine/${id}`,
  room: (id: string, round: string) => `/tournaments/mine/${id}/room/${round}`,
  certificate: (id: string) => `/tournaments/mine/${id}/certificate`,
  organize: '/tournaments/organize',
  create: '/tournaments/organize/new',
  console: (id: string) => `/tournaments/organize/${id}`,
  /** Volunteering to judge lives with the judge area. */
  judge: '/judge',
} as const;
