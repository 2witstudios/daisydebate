import { z } from 'zod';

export const mediaEndpoint = (protocol: RegExp) =>
  z.url({ protocol }).refine((value) => {
    try {
      const url = new URL(value);
      return !url.username && !url.password;
    } catch {
      return false;
    }
  });

/** The configured nodes in order: a comma-separated list, one entry per LiveKit node. */
export const mediaEndpointsOf = (value: string) => value.split(',');

/** One endpoint per node. One entry is a valid list, and the order pairs the two lists. */
export const mediaEndpointList = (protocol: RegExp) =>
  z
    .string()
    .refine((value) =>
      mediaEndpointsOf(value).every(
        (endpoint) => mediaEndpoint(protocol).safeParse(endpoint).success,
      ),
    );
