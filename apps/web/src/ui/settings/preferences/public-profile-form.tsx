'use client';

import { Announcement } from '../../components/announcement/announcement';
import { BIO_MAX, DISPLAY_NAME_MAX } from '@daisy/protocol/public-profile';
import { useState } from 'react';
import { initialSaveForm, saveNotice } from '../../../features/forms/save-form';
import {
  characterCount,
  profileTextUnavailable,
  type ProfileTextFormState,
} from '../../../features/profile/profile-text-form';
import { Button } from '../../components/button/button';
import { controlClass } from '../../components/form-field/form-field-class';
import { FormField } from '../../components/form-field/form-field';
import { useFormAction, type FormAction } from '../../form-action/form-action';

const textareaClass =
  'w-full min-w-0 rounded-md border border-border bg-surface-raised p-3 text-base text-ink';

/** "12 of 40 characters", the count a person sees, as the server counts it. */
export const counterText = (text: string, max: number): string =>
  `${characterCount(text)} of ${max} characters`;

/**
 * The member's display name and bio (ADR 0143): what others see beside the
 * username on their profile, their card and People and Friends. Either
 * may be left empty, which clears it. A refusal keeps what was typed.
 */
export function PublicProfileForm({
  action,
  displayName,
  bio,
}: {
  readonly action: FormAction<ProfileTextFormState>;
  readonly displayName: string | null;
  readonly bio: string | null;
}) {
  const [answer, post, pending] = useFormAction(
    action,
    initialSaveForm,
    profileTextUnavailable,
  );
  const [name, setName] = useState(displayName ?? '');
  const [about, setAbout] = useState(bio ?? '');
  const over =
    characterCount(name) > DISPLAY_NAME_MAX || characterCount(about) > BIO_MAX;
  const notice = saveNotice(answer);
  return (
    <form
      action={post}
      onSubmit={(event) => {
        // The server refuses it too; this only saves a round trip.
        if (over) event.preventDefault();
      }}
      className="flex flex-col gap-4"
    >
      <FormField
        id="profile-display-name"
        label="Display name"
        helper={counterText(name, DISPLAY_NAME_MAX)}
      >
        <input
          id="profile-display-name"
          name="displayName"
          type="text"
          autoComplete="nickname"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-describedby="profile-display-name-helper"
          aria-invalid={characterCount(name) > DISPLAY_NAME_MAX}
          className={controlClass}
        />
      </FormField>
      <FormField
        id="profile-bio"
        label="Bio"
        helper={counterText(about, BIO_MAX)}
      >
        <textarea
          id="profile-bio"
          name="bio"
          rows={3}
          value={about}
          onChange={(event) => setAbout(event.target.value)}
          aria-describedby="profile-bio-helper"
          aria-invalid={characterCount(about) > BIO_MAX}
          className={textareaClass}
        />
      </FormField>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending || over}>
          Save
        </Button>
        {notice ? (
          <Announcement
            as="p"
            kind="progress"
            className="text-sm text-ink-muted"
          >
            {notice}
          </Announcement>
        ) : null}
      </div>
    </form>
  );
}
