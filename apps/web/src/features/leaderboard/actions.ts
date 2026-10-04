/**
 * Where each leaderboard action goes. There is no backend yet, so each
 * points at the nearest existing route and does nothing else: no fake
 * mutation. The real operations replace these destinations here only.
 */
export const leaderboardDestinations = {
  findMatch: '/ranked',
  seasons: '/leaderboard/seasons',
  howRatingWorks: '/leaderboard/seasons#how-rating-works',
  privacy: '/leaderboard/privacy',
} as const;
