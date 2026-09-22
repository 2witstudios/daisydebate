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

type Choosing = Extract<OnboardingState, { step: 'choose' }>;

/** Submitting: an invalid shape never leaves the browser. */
const submit = (state: Choosing): OnboardingState => {
  if (!canSubmit(state)) return state;
  return parseUsername(state.username).ok
    ? { step: 'choose', username: state.username, pending: true }
    : choose(state.username, 'invalid');
};

const settle = (state: Choosing, outcome: ClaimOutcome): OnboardingState => {
  if (!state.pending) return state;
  if (outcome.kind === 'claimed')
    return { step: 'passkey', username: outcome.username };
  // The server page moves a finished account on; nothing to fix here.
  if (outcome.kind === 'already-set') return { step: 'done' };
  return choose(state.username, outcome.kind);
};

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  if (event.type === 'passkey-step-finished')
    return state.step === 'passkey' ? { step: 'done' } : state;
  if (state.step !== 'choose') return state;
  if (event.type === 'typed')
    return state.pending ? state : choose(event.username);
  return event.type === 'submitted'
    ? submit(state)
    : settle(state, event.outcome);
}
