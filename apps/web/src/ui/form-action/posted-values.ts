'use client';
import { useEnclosingFormEvent } from '../edge/use-dom-events';
import { createContext, useContext, useState, type RefObject } from 'react';
import type { FormValues } from '../../features/forms/form-state';

/**
 * The fields a command form last posted, while its answer gives them back
 * (refused, or unacknowledged and awaiting a retry); null otherwise. Fields
 * that mount afresh after the post seed from these before their own default,
 * so a refusal never costs the person what they typed.
 */
export const PostedValues = createContext<FormValues | null>(null);

export const usePostedValues = (): FormValues | null =>
  useContext(PostedValues);

/** A row count a form posted (a non-negative whole number), or null. */
export const postedCount = (
  posted: FormValues | null,
  name: string,
): number | null => {
  const count = Number(posted?.[name]);
  return posted?.[name] !== undefined && Number.isInteger(count) && count >= 0
    ? count
    : null;
};

/**
 * How many times the form holding `anchor` has been reset. A field keyed on
 * it mounts afresh after each reset (never in the commit React resets the
 * form in, where the reset would then act on the fresh field), so a
 * controlled field cannot keep a state its reset DOM no longer shows.
 * `onReset` runs as the reset begins, before the fields are put back.
 */
export function useFormResets(
  anchor: RefObject<Element | null>,
  onReset?: (form: HTMLFormElement) => void,
): number {
  const [resets, setResets] = useState(0);
  useEnclosingFormEvent(anchor, 'reset', (_event, form) => {
    onReset?.(form);
    setResets((count) => count + 1);
  });
  return resets;
}
