import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { accept, field, refuse, type Parsed } from '../mock-form/form';

export const regionChoices = [
  'Europe',
  'North America',
  'Latin America',
  'Asia-Pacific',
  'Africa and the Middle East',
] as const;

export const bioLimit = 160;

export type ProfilePrefs = { readonly bio: string; readonly region: string };
export type NotificationPrefs = {
  readonly judgeOffers: boolean;
  readonly pairings: boolean;
  readonly results: boolean;
  readonly newsletter: boolean;
};
export type PrivacyPrefs = {
  readonly ladder: boolean;
  readonly analytics: boolean;
  readonly replay: boolean;
};

export type Preferences = {
  readonly profile: ProfilePrefs;
  readonly notifications: NotificationPrefs;
  readonly privacy: PrivacyPrefs;
};

/**
 * The Settings page's one data seam: the signed-in account's saved
 * preferences. Today it returns the defaults an account starts with;
 * `analytics` and `replay` start off because not answering counts as
 * declining (privacy). The backend read replaces this function and nothing
 * else.
 */
export const getPreferences = (): Preferences => ({
  profile: { bio: '', region: '' },
  notifications: {
    judgeOffers: true,
    pairings: true,
    results: true,
    newsletter: false,
  },
  privacy: { ladder: true, analytics: false, replay: false },
});

const on = (form: FormData, name: string): boolean =>
  field(form, name) === 'on';

/** The public profile fields, read from the posted form. */
export function parseProfileForm(form: FormData): Parsed<ProfilePrefs> {
  const bio = field(form, 'bio');
  if (bio.length > bioLimit)
    return refuse(`A bio is up to ${bioLimit} characters.`);
  const region = field(form, 'region');
  if (region !== '' && !regionChoices.some((choice) => choice === region))
    return refuse('Choose a region from the list, or leave it blank.');
  return accept({ bio, region });
}

/** Which email to send, read from the posted checkboxes. */
export const parseNotificationsForm = (
  form: FormData,
): Parsed<NotificationPrefs> =>
  accept({
    judgeOffers: on(form, 'judge-offers'),
    pairings: on(form, 'pairings'),
    results: on(form, 'results'),
    newsletter: on(form, 'newsletter'),
  });

/** What is public and what is optional, read from the posted checkboxes. */
export const parsePrivacyForm = (form: FormData): Parsed<PrivacyPrefs> =>
  accept({
    ladder: on(form, 'ladder'),
    analytics: on(form, 'analytics'),
    replay: on(form, 'replay'),
  });

const sections = ['profile', 'notifications', 'privacy'] as const;
export type Section = (typeof sections)[number];

/** Where a saved section goes: back to Settings, to that section. */
export const savedHref = (section: Section): string =>
  `/settings?saved=${section}#${section}`;

export const parseSettingsQuery = (params: SearchParams): Section | null => {
  const value = params['saved'];
  return z
    .enum(sections)
    .nullable()
    .catch(null)
    .parse(typeof value === 'string' ? value : null);
};
