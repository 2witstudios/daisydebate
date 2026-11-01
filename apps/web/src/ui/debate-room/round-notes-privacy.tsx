'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import z from 'zod';
import { NOTES_PRINCIPAL_KEY, publishNotesPrincipal } from './notes-principal';

const sessionSchema = z
  .object({ user: z.object({ id: z.string().min(1) }) })
  .nullable();

/** Root lifetime: private recovery outlives rooms, but never the authenticated account. */
export function RoundNotesPrivacy({
  principalId,
}: {
  readonly principalId: string | null | undefined;
}) {
  const pathname = usePathname();
  useEffect(() => {
    // An unavailable identity read is not evidence of logout.
    if (principalId === undefined) return;
    publishNotesPrincipal(principalId);
    let live = true;
    const check = async () => {
      try {
        const response = await fetch('/api/auth/get-session', {
          cache: 'no-store',
        });
        if (!response.ok) return;
        const result = sessionSchema.safeParse(await response.json());
        if (live && result.success)
          publishNotesPrincipal(result.data?.user.id ?? null);
      } catch {
        // Offline transport does not establish identity loss.
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === NOTES_PRINCIPAL_KEY) {
        // Cross-tab signals withdraw private copies immediately; recheck the
        // authoritative cookie session before any future owner is created.
        publishNotesPrincipal(event.newValue || null);
        void check();
      }
    };
    const submit = (event: SubmitEvent) => {
      if (
        event.target instanceof HTMLFormElement &&
        new URL(event.target.action).pathname === '/auth/sign-out'
      )
        publishNotesPrincipal(null);
    };
    window.addEventListener('focus', check);
    window.addEventListener('storage', storage);
    document.addEventListener('submit', submit, true);
    void check();
    return () => {
      live = false;
      window.removeEventListener('focus', check);
      window.removeEventListener('storage', storage);
      document.removeEventListener('submit', submit, true);
    };
  }, [principalId, pathname]);
  return null;
}
