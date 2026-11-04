'use client';
import { useSyncExternalStore } from 'react';

const never = () => () => undefined;

/** The reader's zone: UTC on the server's render, theirs once hydrated. */
export const useReaderTimeZone = (): string =>
  useSyncExternalStore(
    never,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => 'UTC',
  );
