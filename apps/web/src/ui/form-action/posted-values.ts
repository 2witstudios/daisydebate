'use client';
import { createContext, useContext } from 'react';
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
