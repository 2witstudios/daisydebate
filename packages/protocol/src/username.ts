import { z } from 'zod';

/** 3-32 ASCII letters, digits, underscore or hyphen, checked before lowercasing. */
const USERNAME_SHAPE = /^[A-Za-z0-9_-]{3,32}$/;

export type UsernameParse =
  { readonly ok: true; readonly username: string } | { readonly ok: false };

/**
 * The single username rule shared by the sign-up form and the claim endpoint.
 * Validation runs on the trimmed input before case folding, so characters
 * that only become ASCII when lowercased (KELVIN SIGN) are refused.
 */
export function parseUsername(input: unknown): UsernameParse {
  if (typeof input !== 'string') return { ok: false };
  const trimmed = input.trim();
  return USERNAME_SHAPE.test(trimmed)
    ? { ok: true, username: trimmed.toLowerCase() }
    : { ok: false };
}

/** A command's username field: the same rule, canonicalized on parse. */
export const usernameSchema = z.string().transform((value, context) => {
  const parsed = parseUsername(value);
  if (parsed.ok) return parsed.username;
  context.addIssue({ code: 'custom', message: 'Invalid username' });
  return z.NEVER;
});
