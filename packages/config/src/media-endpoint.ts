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
