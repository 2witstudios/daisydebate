import type { LinkRequestOutcome, SignInPort } from '../sign-in-port';
import type { SignInState } from '../sign-in-state';

/**
 * Deterministic stand-in for the Better Auth adapter (AUTH-4.1). The address
 * picks the outcome so every state is reachable by hand:
 *   …bounce@…  → undeliverable      …limit@…  → rate-limited
 *   …down@…    → unavailable        anything else → sent
 * Passkey ceremonies always report "cancelled": there is no credential.
 */
export const mockLinkOutcome = (email: string): LinkRequestOutcome => {
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.endsWith('bounce')) return { kind: 'undeliverable' };
  if (local.endsWith('limit')) return { kind: 'rate-limited' };
  if (local.endsWith('down')) return { kind: 'unavailable' };
  return { kind: 'sent' };
};

export const mockSignInPort: SignInPort = {
  requestLink: (email) => Promise.resolve(mockLinkOutcome(email)),
  signInWithPasskey: () => Promise.resolve({ kind: 'cancelled' }),
};

export const MOCK_EMAIL = 'jordan@lincoln.edu';

/** Every step a reviewer can open directly with `/sign-in?preview=…`. */
const mockPreviews = [
  'sign-in',
  'check-inbox',
  'confirm',
  'expired',
  'save-passkey',
  'undeliverable',
  'rate-limited',
  'passkey-cancelled',
] as const;

export type MockPreview = (typeof mockPreviews)[number];

/** Untrusted query input: anything unknown is the plain sign-in step. */
export const parseMockPreview = (value: unknown): MockPreview =>
  mockPreviews.find((preview) => preview === value) ?? 'sign-in';

type FlowPreview = Exclude<MockPreview, 'confirm' | 'expired' | 'save-passkey'>;

/** The flow state a preview opens on; `now` (UTC ISO) stamps the inbox. */
export const mockFlowState = (
  preview: FlowPreview,
  now: string,
): SignInState => {
  switch (preview) {
    case 'sign-in':
      return { step: 'enter-email', email: '', pending: 'none' };
    case 'check-inbox':
      return {
        step: 'check-inbox',
        email: MOCK_EMAIL,
        sentAt: now,
        resending: false,
      };
    default:
      return {
        step: 'enter-email',
        email: MOCK_EMAIL,
        pending: 'none',
        notice: preview,
      };
  }
};
