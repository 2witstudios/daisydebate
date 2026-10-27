import { z } from 'zod';
import { optionalJsonConfig } from './json-config';

/** Global sign-up mail capacity; windows are fixed, only ceilings are deploy policy. */
export const signUpMailCeilingsConfig = optionalJsonConfig(
  z.strictObject({ perMinute: z.int().positive(), perDay: z.int().positive() }),
).default({ perMinute: 120, perDay: 3000 });
