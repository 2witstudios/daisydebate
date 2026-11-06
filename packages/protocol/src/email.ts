/** Email identity preserves provider-specific dots and plus addressing. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
