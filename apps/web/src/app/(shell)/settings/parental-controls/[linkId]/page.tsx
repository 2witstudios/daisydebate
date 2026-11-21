import Link from 'next/link';
import { notFound } from 'next/navigation';
import { idSchema } from '@daisy/protocol';
import { errorCodeOf } from '@daisy/errors';
import type { SearchParams } from '../../../../../features/access/decision';
import { requireAccess } from '../../../../../lib/access';
import { requestFamilyViewer } from '../../../../../lib/request-session';
import { processApp } from '../../../../../server/process-app';
import {
  CloseChildAccountForm,
  LinkedGuardianReleaseForm,
} from '../../../../../ui/settings/parental-controls/guardian-more-forms';
import { PageHeader } from '../../../../../ui/components/page-header/page-header';
import {
  ReleaseTerms,
  ReleaseUnchanged,
} from '../../../../../ui/media-releases/parent/release-terms';
import { guardianMoreAction } from './actions';

export const metadata = { title: 'More parental controls' };

export default async function GuardianMorePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly linkId: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { linkId } = await params;
  const caller = await requireAccess(
    `/settings/parental-controls/${linkId}`,
    searchParams,
  );
  const viewer = await requestFamilyViewer();
  if (
    caller.state !== 'member' ||
    viewer?.role !== 'adult' ||
    !idSchema.safeParse(linkId).success
  )
    notFound();
  const release = await processApp()
    .database.mediaReleases.readGuardianRelease({
      guardian: caller.principal,
      linkId,
    })
    .catch((error) => {
      const code = errorCodeOf(error, 'INTERNAL');
      if (code === 'NOT_FOUND' || code === 'AUTHORIZATION') notFound();
      throw error;
    });
  const name = release.username ? `@${release.username}` : 'your child';
  return (
    <main className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 py-5 max-compact:px-4">
      <Link
        href="/settings/parental-controls"
        className="self-start text-sm text-ink-muted"
      >
        Parental controls
      </Link>
      <PageHeader title={`More for ${name}`} />
      <section
        aria-labelledby="media-release"
        className="flex flex-col gap-5 rounded-xl bg-surface p-5 shadow-1"
      >
        <h2 id="media-release" className="font-display text-xl font-bold">
          Media release
        </h2>
        {release.signed ? (
          <p>A media release is on file.</p>
        ) : release.username ? (
          <>
            <ReleaseTerms minor={release.username} />
            <ReleaseUnchanged minor={release.username} />
            <LinkedGuardianReleaseForm
              minor={release.username}
              action={guardianMoreAction.bind(null, linkId, 'sign')}
            />
          </>
        ) : null}
      </section>
      <section
        aria-labelledby="data-account"
        className="flex flex-col gap-4 rounded-xl bg-surface p-5 shadow-1"
      >
        <h2 id="data-account" className="font-display text-xl font-bold">
          Data and account
        </h2>
        <p>
          Closing the account signs {name} out and ends their active media
          release and guardian links. Daisy keeps their reserved username and
          required records, including the competitive record.
        </p>
        <CloseChildAccountForm
          action={guardianMoreAction.bind(null, linkId, 'close')}
        />
      </section>
    </main>
  );
}
