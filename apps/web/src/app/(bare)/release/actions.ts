'use server';

import { headers } from 'next/headers';
import {
  parentUnacknowledged,
  readParentAnswer,
  signedFrom,
  type ManageState,
  type SentState,
  type SignState,
} from '../../../features/media-releases/parent-forms';
import {
  signBodyOf,
  textOf,
  withdrawBodyOf,
} from '../../../features/media-releases/parent-pages';
import { inProcessFetch } from '../../../server/in-process-fetch';
import { releaseNowMs } from '../../../lib/request-session';
import { mediaReleasesReleased } from '../../../features/media-releases/route-release';
import { processRoute } from '../../../server/process-app';

/**
 * The parent's link pages post through the media release routes in process,
 * with this request's headers, so their origin, release and rate-limit gates
 * all apply (ADR 0151). The token is bound by the page and posted in the
 * body, never put in a URL; the route looks it up again, so a bound value
 * the browser altered is only an unknown link.
 */
const routes = {
  sign: processRoute((all, app) =>
    all.mediaReleases.sign(mediaReleasesReleased(app)),
  ),
  answer: processRoute((all, app) =>
    all.mediaReleases.answer(mediaReleasesReleased(app)),
  ),
  withdraw: processRoute((all, app) =>
    all.mediaReleases.withdraw(mediaReleasesReleased(app)),
  ),
  paidAds: processRoute((all, app) =>
    all.mediaReleases.paidAds(mediaReleasesReleased(app)),
  ),
  manageLink: processRoute((all, app) =>
    all.mediaReleases.manageLink(mediaReleasesReleased(app)),
  ),
  stop: processRoute((all, app) =>
    all.mediaReleases.stop(mediaReleasesReleased(app)),
  ),
};

const post = async (
  route: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
) =>
  inProcessFetch(route, new Headers(await headers()))(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Signs the release; the confirmation shows what was signed, and when. */
export async function signReleaseAction(
  token: string,
  _previous: SignState,
  form: FormData,
): Promise<SignState> {
  try {
    const response = await post(
      routes.sign,
      '/api/media-releases/sign',
      signBodyOf(token, form),
    );
    const answer = await readParentAnswer(response, form);
    if (!answer.ok) return answer.state;
    // The time the route accepted it, to the minute the confirmation shows.
    return signedFrom(form, new Date(releaseNowMs()).toISOString());
  } catch {
    return parentUnacknowledged(form);
  }
}

/** Declines the request, or says it was not meant for this address. */
export async function answerReleaseAction(
  token: string,
  outcome: 'declined' | 'not_me',
  _previous: SignState,
  form: FormData,
): Promise<SignState> {
  try {
    const response = await post(routes.answer, '/api/media-releases/answer', {
      token,
      outcome: outcome === 'not_me' ? 'not_me' : 'declined',
    });
    const answer = await readParentAnswer(response, form);
    if (!answer.ok) return answer.state;
    return { kind: 'answered', outcome };
  } catch {
    return parentUnacknowledged(form);
  }
}

/** Withdraws the whole release, or paid advertising only. */
export async function withdrawReleaseAction(
  token: string,
  _previous: ManageState,
  form: FormData,
): Promise<ManageState> {
  try {
    const body = withdrawBodyOf(token, form);
    const response = await post(
      routes.withdraw,
      '/api/media-releases/withdraw',
      body,
    );
    const answer = await readParentAnswer(response, form);
    if (!answer.ok) return answer.state;
    return {
      kind: 'withdrawn',
      what: body.form.what === 'paid_ads' ? 'paid_ads' : 'whole',
    };
  } catch {
    return parentUnacknowledged(form);
  }
}

/** Also allows clips in paid advertising. */
export async function allowPaidAdsAction(
  token: string,
  _previous: ManageState,
  form: FormData,
): Promise<ManageState> {
  try {
    const response = await post(
      routes.paidAds,
      '/api/media-releases/paid-ads',
      { token, allow: true },
    );
    const answer = await readParentAnswer(response, form);
    if (!answer.ok) return answer.state;
    return { kind: 'paid_ads_allowed' };
  } catch {
    return parentUnacknowledged(form);
  }
}

/**
 * Mails a fresh manage link: from a sign link this address already used, or
 * by the address that signed. The answer is the same whether or not a
 * release was found.
 */
export async function mailManageLinkAction(
  token: string | null,
  _previous: SentState,
  form: FormData,
): Promise<SentState> {
  try {
    const response = await post(
      routes.manageLink,
      '/api/media-releases/manage-link',
      token === null ? { email: textOf(form, 'email') } : { token },
    );
    const answer = await readParentAnswer(response, form);
    if (!answer.ok) return answer.state;
    return { kind: 'sent' };
  } catch {
    return parentUnacknowledged(form);
  }
}

/** "Don't send me release requests". */
export async function stopRequestsAction(
  recipientHash: string,
  stopToken: string,
  _previous: SentState,
  form: FormData,
): Promise<SentState> {
  try {
    const response = await post(routes.stop, '/api/media-releases/stop', {
      a: recipientHash,
      t: stopToken,
    });
    const answer = await readParentAnswer(response, form);
    if (!answer.ok) return answer.state;
    return { kind: 'sent' };
  } catch {
    return parentUnacknowledged(form);
  }
}
