import { type ParentLinkRead } from '@daisy/db/stores/media-releases';
import {
  isReleaseRequestOpen,
  releaseRequestStanding,
} from '@daisy/protocol/media-release';

/**
 * What a parent's sign link shows (ADR 0151): the release to sign, a release
 * this link already signed (with a way to get a manage link), or a plain
 * explanation for a link that has expired, closed or never existed.
 */
export type SignPage =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'expired'; readonly minor: string }
  | { readonly kind: 'closed'; readonly minor: string }
  | { readonly kind: 'signed'; readonly minor: string }
  | {
      readonly kind: 'form';
      readonly minor: string;
      readonly requestedAt: string;
      readonly expiresAt: string;
      readonly sentTo: string;
    };

export const signPageOf = (read: ParentLinkRead, nowMs: number): SignPage => {
  if (read.kind === 'unknown' || read.minor.username === null)
    return { kind: 'unknown' };
  const minor = read.minor.username;
  const standing = releaseRequestStanding(read.request, nowMs);
  if (standing === 'signed') return { kind: 'signed', minor };
  if (read.verdict === 'expired' || standing === 'expired')
    return { kind: 'expired', minor };
  if (
    read.verdict !== 'usable' ||
    !isReleaseRequestOpen(read.request, nowMs) ||
    read.standing.kind === 'on_file'
  )
    return { kind: 'closed', minor };
  return {
    kind: 'form',
    minor,
    requestedAt: read.request.requestedAt,
    expiresAt: read.request.expiresAt,
    sentTo: read.request.recipientEmail,
  };
};

/**
 * What a parent's manage link shows: the release it may withdraw or change,
 * or the form that mails a fresh link to the address that signed.
 */
export type ManagePage =
  | { readonly kind: 'ask_for_link'; readonly why: 'none' | 'expired' | 'used' }
  | { readonly kind: 'nothing'; readonly minor: string }
  | {
      readonly kind: 'form';
      readonly minor: string;
      readonly signedAt: string;
      readonly paidAds: boolean;
    };

export const managePageOf = (read: ParentLinkRead | null): ManagePage => {
  if (read === null || read.kind === 'unknown' || read.minor.username === null)
    return { kind: 'ask_for_link', why: 'none' };
  switch (read.verdict) {
    case 'unknown':
      return { kind: 'ask_for_link', why: 'none' };
    case 'expired':
      return { kind: 'ask_for_link', why: 'expired' };
    case 'used':
      return { kind: 'ask_for_link', why: 'used' };
    case 'usable':
      break;
  }
  const { publish, paidAds } = read.held;
  return publish === null
    ? { kind: 'nothing', minor: read.minor.username }
    : {
        kind: 'form',
        minor: read.minor.username,
        signedAt: publish.signedAt,
        paidAds: paidAds !== null,
      };
};

/** Why a parent's command was refused, in words; the reasons the routes answer. */
export const parentRefusalWords = (reason: string): string => {
  switch (reason) {
    case 'expired':
      return 'This link has expired.';
    case 'used':
      return 'This link has already been used. Check your email for a newer one.';
    case 'request_closed':
      return 'This request is closed.';
    case 'already_released':
      return 'A release is already on file.';
    case 'invalid_form':
      return 'Fill in your name and tick the box to confirm.';
    case 'nothing_to_withdraw':
      return 'There is nothing to withdraw: paid advertising was never allowed.';
    case 'no_release':
      return 'There is no release on file to change.';
    case 'unchanged':
      return 'That is already your choice.';
    default:
      return 'This link does not work.';
  }
};

/** A posted checkbox: ticked only when the browser sent it. */
export const ticked = (form: FormData, name: string): boolean =>
  form.get(name) !== null;

/** A posted text field, or empty. */
export const textOf = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
};

/** The sign route's body from the posted form; the route validates it again. */
export const signBodyOf = (token: string, form: FormData) => ({
  token,
  form: {
    name: textOf(form, 'name'),
    relation: textOf(form, 'relation'),
    wordingVersion: textOf(form, 'wordingVersion'),
    attests: ticked(form, 'attests'),
    paidAds: ticked(form, 'paidAds'),
  },
});

/** The withdraw route's body from the posted form. */
export const withdrawBodyOf = (token: string, form: FormData) => ({
  token,
  form: {
    what: textOf(form, 'what'),
    attests: ticked(form, 'attests'),
    note: textOf(form, 'note'),
  },
});
