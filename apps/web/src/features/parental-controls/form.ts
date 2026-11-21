import type { FormState } from '../forms/form-state';

export type GuardianFormState =
  FormState | { readonly kind: 'sent'; readonly message: string };
