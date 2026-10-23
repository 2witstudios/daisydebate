import { z } from 'zod';

/**
 * The production server's own launch settings, validated: it refuses any
 * NODE_ENV but production, the port defaults to 3000, and the listen address
 * (`LISTEN_HOST`, an IP literal) defaults to every interface.
 */
export function readStartOptions(
  env: Readonly<Record<string, string | undefined>>,
) {
  if (env.NODE_ENV !== 'production')
    throw new Error(
      `Production start requires NODE_ENV=production (received ${
        env.NODE_ENV ?? 'unset'
      })`,
    );
  return {
    port: z.coerce
      .number()
      .int()
      .min(1)
      .max(65535)
      .parse(env.PORT ?? 3000),
    host: listenHost(env.LISTEN_HOST ?? '0.0.0.0'),
  };
}

const listenHost = (value: string) => {
  const parsed = z.union([z.ipv4(), z.ipv6()]).safeParse(value);
  if (!parsed.success) throw new Error(`Invalid LISTEN_HOST: ${value}`);
  return parsed.data;
};
