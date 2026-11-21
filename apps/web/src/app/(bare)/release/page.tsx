import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { signPageOf } from '../../../features/media-releases/parent-pages';
import { readReleaseLink, releaseNowMs } from '../../../lib/request-session';
import { AlreadySigned } from '../../../ui/media-releases/parent/link-forms';
import {
  ReleaseFrame,
  ReleaseNotice,
} from '../../../ui/media-releases/parent/release-frame';
import { SignRelease } from '../../../ui/media-releases/parent/sign-release';
import {
  answerReleaseAction,
  mailManageLinkAction,
  signReleaseAction,
} from './actions';

/**
 * The link carries a bearer token: no referrer leaves this page for another
 * origin, and no search engine keeps it (ADR 0019, ADR 0151).
 */
export const metadata: Metadata = {
  title: 'Media release',
  referrer: 'same-origin',
  robots: { index: false, follow: false },
};

const tokenOf = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : '';

/**
 * The parent's sign page (board "Parent signs"), opened from the release
 * email without an account. Reading it changes nothing; signing, declining
 * and "This isn't me" are posts that carry the token in their body.
 */
export default async function ReleasePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const token = tokenOf((await searchParams)['t']);
  const page = signPageOf(await readReleaseLink('sign', token), releaseNowMs());
  return (
    <ReleaseFrame>
      {(() => {
        switch (page.kind) {
          case 'form':
            return (
              <SignRelease
                minor={page.minor}
                requestedAt={page.requestedAt}
                expiresAt={page.expiresAt}
                sentTo={page.sentTo}
                sign={signReleaseAction.bind(null, token)}
                decline={answerReleaseAction.bind(null, token, 'declined')}
                notMe={answerReleaseAction.bind(null, token, 'not_me')}
              />
            );
          case 'signed':
            return (
              <AlreadySigned
                minor={page.minor}
                mail={mailManageLinkAction.bind(null, token)}
              />
            );
          case 'expired':
            return (
              <ReleaseNotice title="This link has expired">
                <p>
                  Release requests work for 14 days. Ask @{page.minor} to send a
                  new one from Daisy.
                </p>
              </ReleaseNotice>
            );
          case 'closed':
            return (
              <ReleaseNotice title="This request is closed">
                <p>
                  It was answered, replaced or cancelled, so there is nothing to
                  sign here.
                </p>
              </ReleaseNotice>
            );
          case 'unknown':
            return (
              <ReleaseNotice title="This link doesn’t work">
                <p>
                  Check that you opened the whole link from the email. Release
                  requests come only from Daisy Debate, which never asks for a
                  password by email.
                </p>
              </ReleaseNotice>
            );
        }
      })()}
    </ReleaseFrame>
  );
}
