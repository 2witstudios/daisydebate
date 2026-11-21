import { z } from 'zod';
const endpointUrl = (value: string): URL | null => {
  try {
    const url = new URL(value);
    return value.trim() === value &&
      ['ws:', 'wss:'].includes(url.protocol) &&
      url.hostname !== '' &&
      !url.hostname.includes('*') &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === ''
      ? url
      : null;
  } catch {
    return null;
  }
};
/** Public transport endpoint, never a credential or a browser-supplied origin. */
export const realtimePublicUrlSchema = z
  .string()
  .refine((value) => endpointUrl(value) !== null);
export function readRealtimePublicUrl(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  const value = env.REALTIME_PUBLIC_URL;
  if (value === undefined) return null;
  const parsed = realtimePublicUrlSchema.safeParse(value);
  if (
    !parsed.success ||
    (env.NODE_ENV === 'production' &&
      endpointUrl(parsed.data)?.protocol !== 'wss:')
  )
    throw new Error('Invalid server configuration: REALTIME_PUBLIC_URL');
  return parsed.data;
}

export const realtimeEndpointFields = {
  REALTIME_PUBLIC_URL: realtimePublicUrlSchema.optional(),
};

export function requireSecureRealtime(
  config: z.output<z.ZodObject<typeof realtimeEndpointFields>>,
  ctx: z.RefinementCtx,
) {
  if (
    config.REALTIME_PUBLIC_URL !== undefined &&
    !config.REALTIME_PUBLIC_URL.startsWith('wss:')
  )
    ctx.addIssue({
      code: 'custom',
      path: ['REALTIME_PUBLIC_URL'],
      message: 'Production requires WSS',
    });
}
