import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { managePageOf } from '../../../../features/media-releases/parent-pages';
import { readReleaseLink } from '../../../../features/media-releases/page-reads';
import { AskForLink } from '../../../../ui/media-releases/parent/link-forms';
import { ManageRelease } from '../../../../ui/media-releases/parent/manage-release';
import {
  ReleaseFrame,
  ReleaseNotice,
} from '../../../../ui/media-releases/parent/release-frame';
import {
  allowPaidAdsAction,
  mailManageLinkAction,
  withdrawReleaseAction,
} from '../actions';

export const metadata: Metadata = {
  title: 'Manage a media release',
  referrer: 'same-origin',
  robots: { index: false, follow: false },
};

const tokenOf = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : '';

/**
 * The withdraw page (board "Signed and withdraw"), from the link in the
 * signed copy; without a usable link, a form that mails a new one.
 */
export default async function ManageReleasePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const token = tokenOf((await searchParams)['t']);
  const page = managePageOf(
    token === '' ? null : await readReleaseLink('manage', token),
  );
  return (
    <ReleaseFrame>
      {(() => {
        switch (page.kind) {
          case 'form':
            return (
              <ManageRelease
                minor={page.minor}
                signedAt={page.signedAt}
                paidAds={page.paidAds}
                withdraw={withdrawReleaseAction.bind(null, token)}
                allowPaidAds={allowPaidAdsAction.bind(null, token)}
              />
            );
          case 'nothing':
            return (
              <ReleaseNotice title="Nothing to manage">
                <p>
                  No release you signed for @{page.minor} is on file any more.
                </p>
              </ReleaseNotice>
            );
          case 'ask_for_link':
            return (
              <AskForLink
                why={page.why}
                mail={mailManageLinkAction.bind(null, null)}
              />
            );
        }
      })()}
    </ReleaseFrame>
  );
}
