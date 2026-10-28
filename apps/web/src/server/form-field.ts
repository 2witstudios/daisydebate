import { createAppError } from '@daisy/errors';

/** One text field that a form must send exactly once. */
export function singleFormField(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== 'string' || form.getAll(key).length !== 1)
    throw createAppError('VALIDATION');
  return value;
}
