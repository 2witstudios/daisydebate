/**
 * Every Judge screen's URL, in one place. Each screen is its own route
 * under the guarded `/judge` root, so the access rule covers them all.
 */
export const judgeRoutes = {
  hub: '/judge',
  rating: '/judge/rating',
  resources: '/judge/resources',
  waiting: '/judge/waiting',
} as const;
