import { parseUsername } from '@daisy/auth';
import type { ClaimOutcome } from './claim-username';
import {
  enrollmentNotices,
  type PasskeyEnrollment,
} from './passkey-enrollment';

export type UsernameNotice =
  'invalid' | 'taken' | 'signed-out' | 'rate-limited' | 'unavailable';

export type OnboardingState =
  | {
      readonly step: 'choose';
      readonly username: string;
      readonly pending: boolean;
      readonly notice?: UsernameNotice;
    }
  | {
      readonly step: 'passkey';
      readonly username: string;
      /** The enrollment seam is running; the choices are locked. */
      readonly saving: boolean;
      /** Why the last attempt saved nothing; never a success. */
      readonly notice?: string;
    }
  | { readonly step: 'done' };

export type OnboardingEvent =
  | { readonly type: 'typed'; readonly username: string }
  | { readonly type: 'submitted' }
  | { readonly type: 'claim-settled'; readonly outcome: ClaimOutcome }
  | { readonly type: 'enroll-started' }
  | { readonly type: 'enroll-settled'; readonly outcome: PasskeyEnrollment }
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
    return { step: 'passkey', username: outcome.username, saving: false };
  // The server page moves a finished account on; nothing to fix here.
  if (outcome.kind === 'already-set') return { step: 'done' };
  return choose(state.username, outcome.kind);
};

type OfferingPasskey = Extract<OnboardingState, { step: 'passkey' }>;

const offer = (
  state: OfferingPasskey,
  event: OnboardingEvent,
): OnboardingState => {
  if (event.type === 'passkey-step-finished') return { step: 'done' };
  if (event.type === 'enroll-started')
    return state.saving ? state : { ...state, saving: true };
  if (event.type !== 'enroll-settled' || !state.saving) return state;
  if (event.outcome.kind === 'saved') return { step: 'done' };
  return {
    step: 'passkey',
    username: state.username,
    saving: false,
    notice: enrollmentNotices[event.outcome.kind],
  };
};

/** True once a submission passed the local check: only then call the server. */
export const awaitsClaim = (state: OnboardingState): boolean =>
  state.step === 'choose' && state.pending;

export function onboardingReducer(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  if (state.step === 'passkey') return offer(state, event);
  if (state.step !== 'choose') return state;
  if (event.type === 'typed')
    return state.pending ? state : choose(event.username);
  if (event.type === 'submitted') return submit(state);
  return event.type === 'claim-settled' ? settle(state, event.outcome) : state;
}
