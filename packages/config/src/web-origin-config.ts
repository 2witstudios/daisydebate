import { z } from 'zod';

export const webOriginFields = {
  PUBLIC_APP_URL: z.url(),
  /** Search engines stay out unless a deployment opens itself: staging never does. */
  SEARCH_INDEXING: z.enum(['open', 'closed']).default('closed'),
};

export const requireHttpsOrigin = (url: string, ctx: z.RefinementCtx) => {
  if (!url.startsWith('https:'))
    ctx.addIssue({
      code: 'custom',
      path: ['PUBLIC_APP_URL'],
      message: 'Production requires HTTPS',
    });
};

export function readBrowserConfig(env: Record<string, string | undefined>) {
  return z
    .object({ PUBLIC_APP_URL: webOriginFields.PUBLIC_APP_URL })
    .parse({ PUBLIC_APP_URL: env.PUBLIC_APP_URL });
}
