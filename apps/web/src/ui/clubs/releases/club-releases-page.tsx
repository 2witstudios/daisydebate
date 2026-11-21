import type { ClubReleaseFilter } from '../../../features/media-releases/club-releases';
import type { FormAction } from '../../form-action/form-action';
import { PageHeader } from '../../components/page-header/page-header';
import { TabLinks } from '../../components/tab-links/tab-links';
import type { ClubFormState } from '../club-form-state';
import {
  ConfirmReleasesForm,
  type ClubReleaseRow,
} from './confirm-releases-form';

const filterLabels: Record<ClubReleaseFilter, string> = {
  needs: 'Needs a release',
  on_file: 'On file',
  everyone: 'Everyone',
};

/**
 * The club's media releases (board RClubReleases, ADR 0151): its Youth
 * students and where each one's release stands, and the confirmation of
 * releases the club already holds.
 */
export function ClubReleasesPage({
  clubId,
  clubName,
  filter,
  counts,
  rows,
  action,
}: {
  readonly clubId: string;
  readonly clubName: string;
  readonly filter: ClubReleaseFilter;
  readonly counts: Readonly<Record<ClubReleaseFilter, number>>;
  readonly rows: readonly ClubReleaseRow[];
  readonly action: FormAction<ClubFormState>;
}) {
  const base = `/clubs/${clubId}/releases`;
  return (
    <>
      <PageHeader
        title="Media releases"
        lede={`Confirm releases ${clubName} already holds, so your Youth students’ Rounds may be clipped, downloaded and reused. Without one, their Rounds can still be watched but not reused.`}
      />
      <TabLinks
        label="Filter students"
        tabs={(['needs', 'on_file', 'everyone'] as const).map((id) => ({
          id,
          label: `${filterLabels[id]} · ${counts[id]}`,
          href: id === 'needs' ? base : `${base}?show=${id}`,
          selected: filter === id,
        }))}
      />
      <ConfirmReleasesForm
        key={filter}
        action={action}
        clubName={clubName}
        rows={rows}
      />
    </>
  );
}
