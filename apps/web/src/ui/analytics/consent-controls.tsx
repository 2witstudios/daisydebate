'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  consentNeeded,
  type AnalyticsAvailability,
  type Consent,
} from '../../features/analytics/consent';
import type { ConsentChoice } from '../../features/analytics/viewer-analytics';
import { buttonClass } from '../components/button/button-class';

/** A preference surface: the viewer's choice when readable, never a guess at it. */
export function ConsentControls({
  choice,
  available,
}: {
  readonly choice: ConsentChoice;
  readonly available: AnalyticsAvailability;
}) {
  if (!available.analytics && !available.replay) return null;
  if (choice.kind === 'unreadable')
    return (
      <p role="status">
        We can&apos;t read your saved privacy choices right now. Reload this
        page to try again.
      </p>
    );
  return <ConsentForm consent={choice.consent} available={available} />;
}

export function ConsentForm({
  consent,
  available,
  banner = false,
}: {
  readonly consent: Consent;
  readonly available: AnalyticsAvailability;
  readonly banner?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    'idle',
  );
  // Saves in place when scripts run; without them the form posts natively.
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const fields = new FormData(event.currentTarget, submitter);
    const body = new URLSearchParams();
    for (const [name, value] of fields)
      if (typeof value === 'string') body.append(name, value);
    setState('saving');
    fetch('/api/analytics/consent', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
      .then((response) => {
        setState(response.ok ? 'saved' : 'failed');
        if (response.ok) router.refresh();
      })
      .catch(() => setState('failed'));
  };
  if (banner && consentNeeded(consent, available).length === 0) return null;
  return (
    <aside
      aria-label="Analytics preferences"
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-6 text-ink shadow-1"
    >
      <h2 className="font-display text-xl font-bold">Your privacy choices</h2>
      <p>
        Optional analytics helps us improve Daisy. Choose whether to share
        product usage. Necessary storage always stays on. You can change your
        choice at any time.
      </p>
      <form
        key={`${consent.analytics}:${consent.replay}`}
        action="/api/analytics/consent"
        method="post"
        onSubmit={save}
        className="flex flex-col gap-4"
      >
        {banner && <input type="hidden" name="scope" value="unanswered" />}
        {!banner && (
          <div className="flex flex-col gap-3">
            {available.analytics && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="analytics"
                  defaultChecked={consent.analytics === 'granted'}
                />
                Product analytics
              </label>
            )}
            {available.replay && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="replay"
                  defaultChecked={consent.replay === 'granted'}
                />
                Masked session replay
              </label>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          {banner ? (
            <button
              name="choice"
              value="accept"
              disabled={state === 'saving'}
              className={buttonClass('secondary')}
            >
              Accept optional
            </button>
          ) : (
            <button
              name="choice"
              value="save"
              disabled={state === 'saving'}
              className={buttonClass('secondary')}
            >
              Save choices
            </button>
          )}
          <button
            name="choice"
            value="deny"
            disabled={state === 'saving'}
            className={buttonClass('secondary')}
          >
            Reject optional
          </button>
          {banner && (
            <Link href="/analytics" className={buttonClass('ghost')}>
              Choose preferences
            </Link>
          )}
        </div>
        {state === 'failed' && (
          <p role="status">We couldn&apos;t save your choice. Try again.</p>
        )}
        {state === 'saved' && !banner && <p role="status">Choices saved.</p>}
      </form>
      <Link href="/privacy" className="text-sm underline">
        Privacy policy
      </Link>
    </aside>
  );
}
