import { createAppError, createInvariantError } from '@daisy/errors';

// Annotated as `never`-returning so a refusal narrows the code after it;
// without the explicit type the compiler cannot see that these never return.
export const refuse: (
  code: Parameters<typeof createAppError>[0],
  message: string,
) => never = (code, message) => {
  throw createAppError(code, message);
};

export const invariant: (id: string, message: string) => never = (
  id,
  message,
) => {
  throw createInvariantError(
    id as Parameters<typeof createInvariantError>[0],
    message,
  );
};
