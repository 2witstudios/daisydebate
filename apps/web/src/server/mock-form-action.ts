import { headers } from 'next/headers';
import {
  refused,
  type MockFormState,
  type Parsed,
} from '../features/mock-form/form';
import { moveOn } from './form-action';

/**
 * One mock form's server action: read the posted form defensively, refuse it
 * with the typed values kept, or move on to `destination`. There is no
 * backend, so an accepted post keeps nothing. A form posted without
 * JavaScript gets a 303; a hydrated page gets `next` and navigates itself.
 */
export async function runMockForm<T>(
  form: unknown,
  parse: (data: FormData) => Parsed<T>,
  destination: (value: T) => string,
): Promise<MockFormState> {
  const data = form instanceof FormData ? form : new FormData();
  const parsed = parse(data);
  if (!parsed.ok) return refused(data, parsed.error);
  return {
    values: {},
    ...moveOn(new Headers(await headers()), destination(parsed.value)),
  };
}
