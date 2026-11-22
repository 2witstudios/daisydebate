import { z } from 'zod';

/** Group activation is independent of release flags and test policy injection. */
export const messagingGroupFields = {
  MESSAGING_PRIVATE_GROUPS: z.literal('staging').optional(),
  FLY_APP_NAME: z.string().min(1).optional(),
};

/** A deployed process must be the named staging app; local proofs opt in explicitly. */
export function refineMessagingGroups(
  config: {
    readonly NODE_ENV: string;
    readonly MESSAGING_PRIVATE_GROUPS?: 'staging' | undefined;
    readonly FLY_APP_NAME?: string | undefined;
  },
  ctx: z.RefinementCtx,
  app: 'web' | 'realtime',
) {
  const stagingApp =
    app === 'web' ? 'daisy-debate-staging' : 'daisy-debate-staging-realtime';
  if (
    config.MESSAGING_PRIVATE_GROUPS === 'staging' &&
    config.NODE_ENV === 'production' &&
    config.FLY_APP_NAME !== stagingApp
  )
    ctx.addIssue({
      code: 'custom',
      path: ['MESSAGING_PRIVATE_GROUPS'],
      message: 'Private groups are staging-only',
    });
}
