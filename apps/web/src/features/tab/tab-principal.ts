import type { AuthorizationInput } from '@daisy/auth/authorization';

/** The signed-in person a Tab command or read is asked by. */
export type TabPrincipal = Extract<
  AuthorizationInput['principal'],
  { readonly kind: 'user' }
>;
