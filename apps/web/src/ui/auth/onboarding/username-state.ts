import { parseUsername } from '@daisy/auth';
import type { ClaimOutcome } from './claim-username';

export type UsernameNotice =
  'invalid' | 'taken' | 'signed-out' | 'rate-limited' | 'unavailable';

export type OnboardingState =
  | {
      readonly step: 'choose';
      readonly username: string;
      readonly pending: boolean;
      readonly notice?: UsernameNotice;
    }
  | { readonly step: 'passkey'; readonly username: string }
  | { readonly step: 'done' };

export type OnboardingEvent =
  | { readonly type: 'typed'; readonly username: string }
  | { readonly type: 'submitted' }
  | { readonly type: 'claim-settled'; readonly outcome: ClaimOutcome }
  | { readonly type: 'passkey-step-finished' };

export const initialOnboardingState: OnboardingState = {
  step: 'choose',
  username: '',
  pending: false,
};

/** Whether submitting now would ask the server: shape is checked locally first. */
export const canSubmit = (state: OnboardingState): boolean =>
  state.step === 'choose' && !state.pending && state.username.trim() !== '';

const choose = (username: string, notice?: UsernameNotice): OnboardingState =>
  notice === undefined
    ? { step: 'choose', username, pending: false }
    : { step: 'choose', username, pending: false, notice };

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  if (event.type === 'passkey-step-finished')
    return state.step === 'passkey' ? { step: 'done' } : state;
  if (state.step !== 'choose') return state;
  switch (event.type) {
    case 'typed':
      return state.pending ? state : choose(event.username);
    case 'submitted':
      if (!canSubmit(state)) return state;
      // An invalid shape never leaves the browser: the rule is the server's own.
      return parseUsername(state.username).ok
        ? { step: 'choose', username: state.username, pending: true }
        : choose(state.username, 'invalid');
    case 'claim-settled': {
      if (!state.pending) return state;
      const { outcome } = event;
      if (outcome.kind === 'claimed')
        return { step: 'passkey', username: outcome.username };
      // The server page moves a finished account on; nothing to fix here.
      if (outcome.kind === 'already-set') return { step: 'done' };
      return choose(state.username, outcome.kind);
    }
  }
}
