'use client';

import Link from 'next/link';
import type { MediaReleaseSettingsView } from '../../../features/media-releases/settings-view';
import {
  ActionForm,
  type FormStateAction,
} from '../../form-action/action-form';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { FormError, FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { Icon } from '../../components/icon/icon';

export type MediaReleaseActions = {
  readonly ask: FormStateAction;
  readonly resend: FormStateAction;
  readonly cancel: FormStateAction;
  readonly askClub: FormStateAction;
};

const row = 'flex flex-wrap items-center gap-2';
const muted = 'text-sm text-ink-muted';
const inner =
  'flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4';

/** What the release covers, as the minor's parent signed it. */
function SignedTerms() {
  return (
    <details className="text-sm text-ink">
      <summary className={`${buttonClass('ghost')} cursor-pointer list-none`}>
        <Icon name="doc" size={18} />
        What was signed
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-ink-muted">
        <li>
          Daisy may publish your ranked Youth Rounds once every Youth debater in
          a Round has a release.
        </li>
        <li>
          Daisy may make and share clips, on Daisy and Daisy’s social media
          accounts.
        </li>
        <li>
          You or your parent can ask for any Round or clip to come down, any
          time.
        </li>
        <li>Paid advertising is a separate choice.</li>
      </ul>
    </details>
  );
}

/** The ask form: a parent's or guardian's address, then Send request. */
function AskForm({
  ask,
  label,
}: {
  readonly ask: FormStateAction;
  readonly label: string;
}) {
  return (
    <ActionForm
      action={ask}
      label={label}
      className={inner}
      focusOnRefusal="parent-email"
    >
      {({ values, error, pending }) => (
        <>
          <div className="flex flex-col gap-1">
            <strong className="text-md font-strong text-ink">
              Ask a parent or guardian to sign
            </strong>
            <span className={muted}>
              We email them a link. They read the release and sign without a
              Daisy account.
            </span>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <FormField id="parent-email" label="Their email">
                <input
                  id="parent-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  defaultValue={values['email'] ?? ''}
                  className={controlClass}
                />
              </FormField>
            </div>
            <button
              type="submit"
              disabled={pending}
              className={`${buttonClass('primary')} max-compact:w-full`}
            >
              <Icon name="send" size={18} />
              Send request
            </button>
          </div>
          <FormError error={error} />
          <span className="text-xs text-ink-muted">
            Only they see this address. We send one reminder after 3 days and
            the link stops working after 14.
          </span>
        </>
      )}
    </ActionForm>
  );
}

/** One button that posts an action, with its refusal under it. */
function ActionButton({
  action,
  label,
  variant,
  icon,
  children,
}: {
  readonly action: FormStateAction;
  readonly label: string;
  readonly variant: 'secondary' | 'ghost';
  readonly icon?: 'send';
  readonly children: string;
}) {
  return (
    <ActionForm action={action} label={label}>
      {({ error, pending }) => (
        <>
          <button
            type="submit"
            disabled={pending}
            className={buttonClass(variant)}
          >
            {icon ? <Icon name={icon} size={18} /> : null}
            {children}
          </button>
          <FormError error={error} />
        </>
      )}
    </ActionForm>
  );
}

const takedown = (
  <Link href="/recordings?scope=mine" className={buttonClass('secondary')}>
    <Icon name="leave" size={18} />
    Request a takedown
  </Link>
);

/**
 * A youth member's media release (ADR 0151, board "Settings media release"):
 * ask a parent, wait for them, or see what is on file.
 */
export function MediaReleaseSection({
  view,
  actions,
}: {
  readonly view: MediaReleaseSettingsView;
  readonly actions: MediaReleaseActions;
}) {
  switch (view.kind) {
    case 'none':
      return (
        <>
          <div className={row}>
            <Badge>
              <Icon name="lock" size={12} />
              No release
            </Badge>
            <span className={muted}>{view.privateRounds}</span>
          </div>
          <p className="text-base text-ink">
            You are under 18, so your ranked Rounds are in the Youth lobby. They
            are recorded but private: only you, the debaters and judges in the
            Round, your coach and your parent can watch. A media release lets
            Daisy publish them and make clips.
          </p>
          {view.withdrawnNote ? (
            <p className={muted}>{view.withdrawnNote}</p>
          ) : null}
          <AskForm ask={actions.ask} label="Ask a parent or guardian to sign" />
          {view.clubs.length > 0 ? (
            <ActionForm
              action={actions.askClub}
              label="Ask my club"
              className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-dashed border-border-strong px-4 py-3"
            >
              {({ error, pending }) => (
                <>
                  <Icon name="home" size={22} />
                  <div className="min-w-0 flex-1">
                    <strong className="font-strong">
                      Debate with a school or club?
                    </strong>
                    <div className={muted}>
                      If it already holds a signed release for you, it can
                      confirm it on Daisy instead.
                    </div>
                  </div>
                  {view.clubs.length === 1 ? (
                    <input
                      type="hidden"
                      name="club"
                      value={view.clubs[0]!.id}
                    />
                  ) : (
                    <select
                      name="club"
                      aria-label="Club"
                      className={`${controlClass} w-auto`}
                    >
                      {view.clubs.map((club) => (
                        <option key={club.id} value={club.id}>
                          {club.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    disabled={pending || view.clubs.every((club) => club.asked)}
                    className={buttonClass('secondary')}
                  >
                    {view.clubs.every((club) => club.asked)
                      ? 'Club asked'
                      : 'Ask my club'}
                  </button>
                  <div className="w-full">
                    <FormError error={error} />
                  </div>
                </>
              )}
            </ActionForm>
          ) : null}
        </>
      );
    case 'waiting':
      return (
        <>
          <div className={row}>
            <Badge tone="gold">
              <Icon name="clock" size={12} />
              Waiting for parent
            </Badge>
            <span className={muted}>{view.line}</span>
          </div>
          <p className="text-base text-ink">
            We emailed <strong className="font-strong">{view.recipient}</strong>
            . Your Rounds stay private until they sign.
          </p>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              action={actions.resend}
              label="Send again"
              variant="secondary"
              icon="send"
            >
              Send again
            </ActionButton>
            <details className="contents">
              <summary
                className={`${buttonClass('secondary')} cursor-pointer list-none`}
              >
                Use another email
              </summary>
              <div className="w-full">
                <AskForm ask={actions.ask} label="Use another email" />
              </div>
            </details>
            <ActionButton
              action={actions.cancel}
              label="Cancel request"
              variant="ghost"
            >
              Cancel request
            </ActionButton>
          </div>
        </>
      );
    case 'parent':
    case 'club':
      return (
        <>
          <div className={row}>
            <Badge tone="accent">
              <Icon name="check" size={12} />
              {view.kind === 'parent'
                ? 'On file · parent'
                : 'Confirmed by club'}
            </Badge>
            <span className={muted}>{view.line}</span>
          </div>
          {view.kind === 'parent' ? (
            <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
              <ul className="m-0 list-none p-0">
                <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3">
                  <strong className="min-w-0 flex-1 font-strong">
                    Publish Rounds and clips on Daisy and social media
                  </strong>
                  <Badge tone="accent">
                    <Icon name="check" size={12} />
                    Allowed
                  </Badge>
                </li>
                <li className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <strong className="font-strong">
                      Use clips in paid advertising
                    </strong>
                    <div className={muted}>
                      A separate choice your parent made. Only they can change
                      it.
                    </div>
                  </div>
                  {view.paidAds ? (
                    <Badge tone="accent">
                      <Icon name="check" size={12} />
                      Allowed
                    </Badge>
                  ) : (
                    <Badge>Not allowed</Badge>
                  )}
                </li>
              </ul>
            </div>
          ) : (
            <p className="text-base text-ink">
              Your school holds your signed release, so you don’t need one on
              Daisy. Questions about it go to your coach. Paid advertising:{' '}
              {view.paidAds ? 'covered' : 'not covered'}.
            </p>
          )}
          <p className={muted}>
            A Round goes public only when every Youth debater in it has a
            release. You can ask for any Round or clip to come down.
          </p>
          <div className="flex flex-wrap gap-2">
            {takedown}
            {view.kind === 'parent' ? <SignedTerms /> : null}
          </div>
        </>
      );
  }
}
