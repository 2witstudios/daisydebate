'use client';

import type { ReactNode } from 'react';
import {
  bioLimit,
  regionChoices,
  type NotificationPrefs,
  type PrivacyPrefs,
  type ProfilePrefs,
} from '../../../features/settings/preferences';
import { buttonClass } from '../../components/button/button-class';
import { FormError, FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { MockForm, type MockFormAction } from '../../form-action/mock-form';

function Check({
  name,
  label,
  helper,
  checked,
  disabled,
}: {
  readonly name: string;
  readonly label: string;
  readonly helper?: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
}): ReactNode {
  return (
    <label className="flex items-start gap-3 text-base text-ink">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        disabled={disabled}
        className="mt-1 size-5 accent-accent"
      />
      <span className="flex flex-col">
        <span className="font-strong">{label}</span>
        {helper ? (
          <span className="text-sm text-ink-muted">{helper}</span>
        ) : null}
      </span>
    </label>
  );
}

const submit = `${buttonClass('secondary')} w-fit`;

/** The public profile: a bio and an optional region. */
export function ProfileForm({
  action,
  prefs,
}: {
  readonly action: MockFormAction;
  readonly prefs: ProfilePrefs;
}) {
  return (
    <MockForm action={action} label="Profile" className="flex flex-col gap-4">
      {({ values, error, pending }) => (
        <>
          <FormField
            id="bio"
            label="Bio"
            helper={`Shown on your public profile. Up to ${bioLimit} characters.`}
          >
            <textarea
              id="bio"
              name="bio"
              rows={3}
              maxLength={bioLimit}
              defaultValue={values['bio'] ?? prefs.bio}
              aria-describedby="bio-helper"
              className="w-full min-w-0 rounded-md border border-border bg-surface-raised p-3 text-base text-ink"
            />
          </FormField>
          <FormField
            id="region"
            label="Region"
            helper="Optional. Lets other debaters filter the ladder by region."
          >
            <select
              id="region"
              name="region"
              defaultValue={values['region'] ?? prefs.region}
              aria-describedby="region-helper"
              className={controlClass}
            >
              <option value="">Not shown</option>
              {regionChoices.map((region) => (
                <option key={region} value={region}>
                  {region}
                </option>
              ))}
            </select>
          </FormField>
          <FormError error={error} />
          <button type="submit" disabled={pending} className={submit}>
            {pending ? 'Saving…' : 'Save profile'}
          </button>
        </>
      )}
    </MockForm>
  );
}

/** Which email Daisy sends you. */
export function NotificationsForm({
  action,
  prefs,
}: {
  readonly action: MockFormAction;
  readonly prefs: NotificationPrefs;
}) {
  return (
    <MockForm
      action={action}
      label="Notifications"
      className="flex flex-col gap-4"
    >
      {({ error, pending }) => (
        <>
          <Check
            name="judge-offers"
            label="Judge offers"
            helper="When a debate is ready for you to judge."
            checked={prefs.judgeOffers}
          />
          <Check
            name="pairings"
            label="Tournament pairings"
            helper="When a round is released and check-in opens."
            checked={prefs.pairings}
          />
          <Check
            name="results"
            label="Results"
            helper="When a ballot comes in on a debate you were in."
            checked={prefs.results}
          />
          <Check
            name="newsletter"
            label="The Scoreboard newsletter"
            helper="News and results from the community. For members 16 and over."
            checked={prefs.newsletter}
          />
          <FormError error={error} />
          <button type="submit" disabled={pending} className={submit}>
            {pending ? 'Saving…' : 'Save notifications'}
          </button>
        </>
      )}
    </MockForm>
  );
}

/** What is public, and the optional data categories you allow. */
export function PrivacyForm({
  action,
  prefs,
}: {
  readonly action: MockFormAction;
  readonly prefs: PrivacyPrefs;
}) {
  return (
    <MockForm action={action} label="Privacy" className="flex flex-col gap-4">
      {({ error, pending }) => (
        <>
          <Check
            name="ladder"
            label="Appear on the public ladder"
            helper="Hidden debaters keep their rating and show as a private debater so ranks do not shift."
            checked={prefs.ladder}
          />
          <Check
            name="show-region"
            label="Show my region on the ladder"
            checked={prefs.showRegion}
          />
          <fieldset className="flex flex-col gap-3 border-t border-border pt-4">
            <legend className="mb-1 text-sm font-strong text-ink">
              Data we may use
            </legend>
            <Check
              name="necessary"
              label="Necessary"
              helper="Sign-in and security. Always on."
              checked
              disabled
            />
            <Check
              name="analytics"
              label="Analytics"
              helper="Counts how the product is used so we can improve it."
              checked={prefs.analytics}
            />
            <Check
              name="replay"
              label="Session replay"
              helper="Records your screen in the app to help fix bugs."
              checked={prefs.replay}
            />
          </fieldset>
          <FormError error={error} />
          <button type="submit" disabled={pending} className={submit}>
            {pending ? 'Saving…' : 'Save privacy settings'}
          </button>
        </>
      )}
    </MockForm>
  );
}
