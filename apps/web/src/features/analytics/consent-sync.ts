import type { Consent } from './consent';

/** Same-origin notification only. The refreshed server, never this marker, authorizes capture. */
export function watchConsent(
  input: { readonly consent: Consent; readonly userId: string | null },
  changed: () => void,
) {
  const key = 'daisy-analytics-consent';
  const receive = (event: StorageEvent) => {
    if (event.key === key) changed();
  };
  window.addEventListener('storage', receive);
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify([input.consent, input.userId]),
    );
  } catch {
    /* Storage can be unavailable under a browser policy. */
  }
  return () => window.removeEventListener('storage', receive);
}
