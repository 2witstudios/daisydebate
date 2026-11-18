'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { done, field, refused } from '../../../features/forms/form-state';
import { inProcessFetch } from '../../../server/in-process-fetch';
import {
  clubFormUnavailable,
  type ClubFormState,
} from '../../../ui/clubs/club-form-state';
import {
  clubConfirmRefusalCopy,
  clubConfirmRefusalOf,
} from '../../../ui/clubs/releases/release-copy';
import { POST as confirmRoute } from '../../api/clubs/[club]/releases/route';

const clubId = /^[a-z0-9]{24}$/;

/**
 * The club confirms releases it holds for the selected students (ADR 0151),
 * through the route a script would call, so its flag, origin, budget and
 * club-staff gates all apply.
 */
export async function confirmClubReleasesAction(
  club: string,
  _previous: ClubFormState,
  form: FormData,
): Promise<ClubFormState> {
  if (!clubId.test(club))
    return refused(form, clubConfirmRefusalCopy.unavailable);
  const students = form
    .getAll('student')
    .filter((value): value is string => typeof value === 'string');
  if (students.length === 0)
    return refused(form, clubConfirmRefusalCopy.none_selected);
  try {
    const response = await inProcessFetch(
      confirmRoute,
      new Headers(await headers()),
    )(`/api/clubs/${club}/releases`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        students,
        form: {
          warrants: field(form, 'warrants') === 'on',
          paidAds: field(form, 'paidAds') === 'yes',
          name: field(form, 'name'),
          role: field(form, 'role'),
        },
      }),
    });
    if (response.status >= 500) return clubFormUnavailable(form);
    if (!response.ok)
      return refused(
        form,
        response.status === 429
          ? clubConfirmRefusalCopy.too_many
          : clubConfirmRefusalCopy.unavailable,
      );
    const answer = (await response.json().catch(() => null)) as {
      readonly kind?: unknown;
      readonly reason?: unknown;
    } | null;
    if (answer?.kind === 'confirmed') {
      revalidatePath(`/clubs/${club}/releases`);
      revalidatePath(`/clubs/${club}/youth`);
      return done();
    }
    return refused(form, clubConfirmRefusalOf(answer?.reason));
  } catch {
    return clubFormUnavailable(form);
  }
}
