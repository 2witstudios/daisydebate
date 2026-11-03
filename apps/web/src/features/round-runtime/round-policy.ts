/**
 * The Round's own request budgets and body bound. Committed, so a Round does
 * not wait on a deployment secret; a Round exists only once a Room made one.
 */
export const ROUND_POLICY = {
  limits: {
    read: { max: 500, windowSeconds: 60 },
    command: { max: 200, windowSeconds: 60 },
  },
  maxBodyBytes: 262_144,
} as const;
