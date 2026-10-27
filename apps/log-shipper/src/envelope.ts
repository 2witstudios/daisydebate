import { z } from 'zod';

/**
 * One record of Fly's org log stream (NATS subject
 * `logs.<app>.<region>.<instance>`). Only the app, region, instance and the
 * process's own stdout line are read; the rest of the envelope is ignored.
 */
export type FlyLogRecord = {
  readonly app: string;
  readonly region: string;
  readonly instance: string;
  readonly message: string;
};

/** A Fly app name; the configured app list uses the same schema. */
export const flyAppName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/);
const envelopeSchema = z.object({
  fly: z.object({
    app: z.object({
      name: flyAppName,
      instance: z.string().regex(/^[a-z0-9]{1,32}$/),
    }),
    region: z.string().regex(/^[a-z]{3}$/),
  }),
  message: z.string(),
});

/** The record, or null for anything that is not a well-formed envelope. */
export function parseEnvelope(data: string): FlyLogRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const result = envelopeSchema.safeParse(parsed);
  if (!result.success) return null;
  const { fly, message } = result.data;
  return {
    app: fly.app.name,
    region: fly.region,
    instance: fly.app.instance,
    message,
  };
}
