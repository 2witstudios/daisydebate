'use client';

import type { ReactNode } from 'react';
import { systemClock, type Clock } from '@daisy/clock';
import { Button } from '../../components/button/button';
import { Icon } from '../../components/icon/icon';
import { CheckInbox } from '../../auth/check-inbox/check-inbox';
import { fieldClass } from '../../auth/email-field/field-class';
import { CopyNotice } from '../../auth/notice/notice';
import { signInNotices } from '../../auth/sign-in-notices';
import { canRequestLink, resendRemainingMs } from '../../auth/sign-in-state';
import {
  useLinkRequest,
  type RequestLinkAction,
} from '../../auth/sign-in-flow/use-link-request';
import { SIGN_IN_EMAIL_ID } from '../../auth/sign-in-form/sign-in-form';

const NOTICE_ID = 'hero-join-notice';

export type HeroJoinProps = {
  /** The sign-in page's own link request, so both surfaces answer alike. */
  readonly requestLink: RequestLinkAction;
  /** Photograph and scrim, server-rendered; dropped once the inbox step shows. */
  readonly backdrop: ReactNode;
  /** The hero's copy, laid out beside the form. */
  readonly children: ReactNode;
  /** Injected so the resend cooldown never reads ambient time. */
  readonly clock?: Clock;
};

/**
 * The hero's one-email join. It is the sign-in link request, not a second
 * one: the same server action and the same reducer, so an answer here is
 * what `/sign-in` answers for the same request. The form posts without
 * JavaScript; a sent link swaps the banner for the sign-in inbox step.
 */
export function HeroJoin({
  requestLink,
  backdrop,
  children,
  clock = systemClock,
}: HeroJoinProps) {
  const { state, dispatch, now, postLink, resend, changeEmail } =
    useLinkRequest(requestLink, clock);

  if (state.step === 'check-inbox')
    return (
      <CheckInbox
        email={state.email}
        resendInMs={resendRemainingMs(
          state.sentAt,
          now > state.sentAt ? now : state.sentAt,
        )}
        resending={state.resending}
        resend={resend}
        changeEmail={changeEmail}
      />
    );
  if (state.step !== 'enter-email') return null;

  const busy = state.pending !== 'none';
  const copy =
    state.notice === undefined ? undefined : signInNotices[state.notice];
  return (
    <section className="relative isolate flex min-h-hero-min items-end justify-between gap-8 overflow-hidden rounded-xl p-10 max-tiles:min-h-hero-min-compact max-tiles:p-6 max-tiny:min-h-hero-min-tiny max-tiny:p-5">
      {backdrop}
      <div className="relative flex max-w-hero-content flex-col items-start gap-4">
        {children}
        <form
          action={postLink}
          aria-busy={busy}
          className="flex w-full flex-col gap-3"
          onSubmit={(event) => {
            if (!canRequestLink(state)) return event.preventDefault();
            dispatch({ type: 'link-requested' });
          }}
        >
          <label htmlFor={SIGN_IN_EMAIL_ID} className="sr-only">
            Email
          </label>
          <div className={fieldClass.row}>
            <input
              id={SIGN_IN_EMAIL_ID}
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={state.email}
              onChange={(event) =>
                dispatch({
                  type: 'email-typed',
                  email: event.currentTarget.value,
                })
              }
              disabled={busy}
              aria-invalid={state.notice === 'undeliverable' ? true : undefined}
              aria-describedby={
                state.notice === 'undeliverable' ? NOTICE_ID : undefined
              }
              className={fieldClass.input}
            />
            <Button type="submit" disabled={busy} className="h-auth-control">
              {state.pending === 'link' ? 'Sending…' : 'Join the waitlist'}
              <Icon name="arrowRight" size={18} />
            </Button>
          </div>
          <CopyNotice id={NOTICE_ID} copy={copy} />
          <p className="text-sm text-ink-on-media/80">
            By joining you agree to our{' '}
            <a href="/terms" className="text-ink-on-media underline">
              Terms
            </a>{' '}
            and{' '}
            <a href="/privacy" className="text-ink-on-media underline">
              Privacy Policy
            </a>
            .
          </p>
        </form>
      </div>
    </section>
  );
}
