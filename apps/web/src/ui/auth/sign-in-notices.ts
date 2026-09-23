import type { NoticeTone } from './notice/notice-class';
import type { SignInNotice } from './sign-in-state';

export type NoticeCopy = {
  readonly tone: NoticeTone;
  readonly title: string;
  readonly body: string;
};

/**
 * What each refused request says. Errors name the problem and the way out;
 * a cancelled or unsupported passkey is information, not a failure, because
 * the email path is still right there.
 */
export const signInNotices: Readonly<Record<SignInNotice, NoticeCopy>> = {
  undeliverable: {
    tone: 'error',
    title: 'We cannot send sign-in emails to this address.',
    body: 'Sign in with a passkey or use a different address.',
  },
  'rate-limited': {
    tone: 'error',
    title: 'Too many attempts for now.',
    body: 'Wait a few minutes, then try again. Links you already asked for still work.',
  },
  unavailable: {
    tone: 'error',
    title: 'Sign-in is temporarily unavailable.',
    body: 'Please try again shortly.',
  },
  'passkey-cancelled': {
    tone: 'info',
    title: 'No passkey used.',
    body: 'New here? Continue with your email.',
  },
  'passkey-unsupported': {
    tone: 'info',
    title: 'This browser cannot use passkeys.',
    body: 'Continue with your email instead.',
  },
  'passkey-failed': {
    tone: 'error',
    title: 'We could not sign you in with a passkey.',
    body: 'Try again, or continue with your email.',
  },
};
