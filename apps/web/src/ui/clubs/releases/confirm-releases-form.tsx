'use client';

import { useState } from 'react';
import { mediaReleaseWording } from '@daisy/protocol/media-release';
import type { StandingBadge } from '../../../features/media-releases/release-words';
import type { FormAction } from '../../form-action/form-action';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import type { BadgeTone } from '../../components/badge/badge-class';
import { Button } from '../../components/button/button';
import { FormField } from '../../components/form-field/form-field';
import { controlClass } from '../../components/form-field/form-field-class';
import { ClubForm } from '../club-form';
import type { ClubFormState } from '../club-form-state';

/** One student's row, as the server worked it out. */
export type ClubReleaseRow = {
  readonly userId: string;
  readonly username: string | null;
  readonly line: string;
  readonly badge: StandingBadge;
  readonly badgeText: string;
  readonly source: string | null;
  readonly sourceNote: string | null;
  readonly selectable: boolean;
};

export const releaseBadgeTone: Record<StandingBadge, BadgeTone> = {
  none: 'neutral',
  waiting: 'gold',
  on_file_parent: 'accent',
  on_file_club: 'accent',
  withdrawn: 'clay',
};

const nameOf = (row: ClubReleaseRow) =>
  row.username === null ? 'A student' : `@${row.username}`;

const names = (list: readonly string[]) =>
  list.length <= 1
    ? (list[0] ?? '')
    : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;

const cell = 'border-t border-border px-3 py-3 align-top text-sm';
const head =
  'px-3 pb-2 text-left text-xs font-bold tracking-widest text-ink-muted uppercase';
const box = 'size-5 shrink-0 accent-accent';
const choice =
  'flex min-h-nav-target cursor-pointer items-start gap-3 rounded-lg px-1 py-2';

/**
 * The club confirms releases it already holds (board RClubReleases): pick
 * students, warrant the club holds a parent-signed release for each, say
 * whether it covers paid ads, and sign with a name and role.
 */
export function ConfirmReleasesForm({
  action,
  clubName,
  rows,
}: {
  readonly action: FormAction<ClubFormState>;
  readonly clubName: string;
  readonly rows: readonly ClubReleaseRow[];
}) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const chosen = rows.filter((row) => selected.includes(row.userId));
  const selectable = rows.filter((row) => row.selectable);
  const allChosen =
    selectable.length > 0 && chosen.length === selectable.length;
  const toggle = (userId: string, on: boolean) =>
    setSelected((now) =>
      on ? [...now, userId] : now.filter((id) => id !== userId),
    );
  const count = chosen.length;
  const noun = count === 1 ? 'release' : 'releases';
  return (
    <ClubForm
      action={action}
      label="Confirm media releases"
      className="flex flex-col gap-6"
    >
      {({ values, pending, done }) => (
        <>
          <input
            type="hidden"
            name="wordingVersion"
            value={mediaReleaseWording.version}
          />
          <div className="overflow-x-auto rounded-xl border border-border bg-surface-raised">
            <table className="w-full min-w-club-releases border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={`${head} pt-3`}>
                    <label className="flex min-h-nav-target items-center gap-3">
                      <input
                        type="checkbox"
                        className={box}
                        checked={allChosen}
                        disabled={selectable.length === 0}
                        onChange={(event) =>
                          setSelected(
                            event.target.checked
                              ? selectable.map((row) => row.userId)
                              : [],
                          )
                        }
                        aria-label="Select every student who needs a release"
                      />
                      Student
                    </label>
                  </th>
                  <th scope="col" className={`${head} pt-3`}>
                    Release
                  </th>
                  <th scope="col" className={`${head} pt-3`}>
                    Source
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={`${cell} text-ink-muted`}>
                      No Youth students here.
                    </td>
                  </tr>
                ) : null}
                {rows.map((row) => (
                  <tr key={row.userId}>
                    <th scope="row" className={`${cell} text-left`}>
                      <label className="flex min-h-nav-target items-center gap-3">
                        <input
                          type="checkbox"
                          name="student"
                          value={row.userId}
                          className={box}
                          checked={selected.includes(row.userId)}
                          disabled={!row.selectable}
                          onChange={(event) =>
                            toggle(row.userId, event.target.checked)
                          }
                          aria-label={`Select ${nameOf(row)}`}
                        />
                        <Avatar name={row.username ?? 'Student'} />
                        <span className="flex min-w-0 flex-col">
                          <strong className="font-strong">{nameOf(row)}</strong>
                          {row.line ? (
                            <span className="font-book text-ink-muted">
                              {row.line}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    </th>
                    <td className={cell}>
                      <Badge tone={releaseBadgeTone[row.badge]}>
                        {row.badgeText}
                      </Badge>
                    </td>
                    <td className={cell}>
                      {row.source ?? '—'}
                      {row.sourceNote ? (
                        <div className="text-ink-muted">{row.sourceNote}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section
            aria-labelledby="confirm-releases-h"
            className="flex flex-col gap-4 rounded-xl bg-surface-raised p-5 shadow-1"
          >
            <div className="flex flex-col gap-1">
              <h2
                id="confirm-releases-h"
                className="font-display text-xl font-bold"
              >
                {count === 0 ? 'Confirm releases' : `Confirm ${count} ${noun}`}
              </h2>
              <span className="text-sm text-ink-muted">
                {count === 0
                  ? 'Select the students whose releases the club holds.'
                  : names(chosen.map(nameOf))}
              </span>
            </div>
            <label className={choice}>
              <input
                type="checkbox"
                name="warrants"
                value="on"
                required
                className={`${box}`}
              />
              <span className="min-w-0">
                {clubName} holds a media release signed by a parent or guardian
                of each selected student, covering clipping, download and reuse
                of their debate recordings.
                <span className="mt-1 block text-sm">
                  <span className="rounded-sm bg-gold-soft px-1 font-strong text-gold">
                    [COUNSEL: club attestation wording, retention and audit
                    duties]
                  </span>
                </span>
              </span>
            </label>
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 font-strong">
                Do these releases also cover paid advertising?
              </legend>
              <label className={choice}>
                <input
                  type="radio"
                  name="paidAds"
                  value="no"
                  defaultChecked={values.paidAds !== 'yes'}
                  className={`${box}`}
                />
                <span className="flex flex-col">
                  <span className="font-strong">No</span>
                  <span className="text-sm text-ink-muted">
                    Daisy won’t use these students in paid ads.
                  </span>
                </span>
              </label>
              <label className={choice}>
                <input
                  type="radio"
                  name="paidAds"
                  value="yes"
                  defaultChecked={values.paidAds === 'yes'}
                  className={`${box}`}
                />
                <span className="flex flex-col">
                  <span className="font-strong">
                    {count <= 1 ? 'Yes' : `Yes, for all ${count}`}
                  </span>
                  <span className="text-sm text-ink-muted">
                    Only if your form says so.{' '}
                    <span className="rounded-sm bg-gold-soft px-1 font-strong text-gold">
                      [COUNSEL: ad-use attestation]
                    </span>
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="flex flex-wrap gap-4">
              <div className="min-w-0 flex-1 basis-club-field">
                <FormField id="attester-name" label="Your name">
                  <input
                    id="attester-name"
                    name="name"
                    required
                    maxLength={120}
                    autoComplete="name"
                    defaultValue={values.name ?? ''}
                    className={controlClass}
                  />
                </FormField>
              </div>
              <div className="min-w-0 flex-1 basis-club-field">
                <FormField
                  id="attester-role"
                  label={`Your role at ${clubName}`}
                >
                  <input
                    id="attester-role"
                    name="role"
                    required
                    maxLength={120}
                    autoComplete="organization-title"
                    defaultValue={values.role ?? ''}
                    className={controlClass}
                  />
                </FormField>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={pending || count === 0}>
                {count === 0 ? 'Confirm releases' : `Confirm ${count} ${noun}`}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={count === 0}
                onClick={() => setSelected([])}
              >
                Clear selection
              </Button>
            </div>
            {done ? (
              <p role="status" className="text-sm text-ink-muted">
                Releases confirmed.
              </p>
            ) : null}
            <p className="text-sm text-ink-muted">
              We record who confirmed, when and the wording. A student’s pending
              parent request is cancelled. Students and parents can still
              withdraw from Daisy.
            </p>
          </section>
        </>
      )}
    </ClubForm>
  );
}
