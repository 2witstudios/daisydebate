import Link from 'next/link';
import type { YouthStudentFilter } from '../../../features/media-releases/club-releases';
import type { StandingBadge } from '../../../features/media-releases/release-words';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { AutoSubmitForm } from '../../components/filter-bar/auto-submit-form';
import { controlClass } from '../../components/filter-form/filter-form';
import { Icon } from '../../components/icon/icon';
import { PageHeader } from '../../components/page-header/page-header';
import { releaseBadgeTone } from './confirm-releases-form';

/** One Youth student, as the coach view shows them. */
export type YouthStudentRow = {
  readonly userId: string;
  readonly username: string | null;
  readonly badge: StandingBadge;
  readonly badgeText: string;
  readonly recordings: string;
};

const filterLabels: Record<YouthStudentFilter, string> = {
  any: 'Any release status',
  none: 'No release',
  waiting: 'Waiting for parent',
  on_file: 'On file',
};

function Tile({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface-raised px-4 py-3">
      <span className="text-sm text-ink-muted">{label}</span>
      <strong className="font-display text-2xl">{value}</strong>
      <span className="text-sm text-ink-muted">{detail}</span>
    </div>
  );
}

/**
 * The coach view (board RTabCoachView, ADR 0151): the club's Youth students
 * and whether their Rounds can be published. Youth tournament entries join
 * it once Youth events open; until then it lists the students themselves.
 */
export function YouthStudentsPage({
  clubId,
  filter,
  tallies,
  rows,
}: {
  readonly clubId: string;
  readonly filter: YouthStudentFilter;
  readonly tallies: {
    readonly onFile: number;
    readonly youth: number;
    readonly waiting: number;
    readonly waitingNames: readonly string[];
    readonly privateRounds: number;
  };
  readonly rows: readonly YouthStudentRow[];
}) {
  return (
    <>
      <PageHeader
        title="Youth tournaments"
        lede="Your students under 18, and whether their Rounds can be published."
        actions={
          <Link
            href={`/clubs/${clubId}/releases`}
            className={buttonClass('primary')}
          >
            <Icon name="check" size={18} />
            Confirm releases
          </Link>
        }
      />
      <div className="grid grid-cols-club-stats gap-3">
        <Tile
          label="Releases on file"
          value={`${tallies.onFile} of ${tallies.youth}`}
          detail="Youth students"
        />
        <Tile
          label="Waiting on a parent"
          value={String(tallies.waiting)}
          detail={
            tallies.waitingNames.length === 0
              ? 'Nobody'
              : tallies.waitingNames.join(', ')
          }
        />
        <Tile
          label="Private Rounds"
          value={String(tallies.privateRounds)}
          detail="no public video until signed"
        />
      </div>
      <AutoSubmitForm className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="youth-release" className="text-sm font-strong">
            Release
          </label>
          <select
            id="youth-release"
            name="release"
            defaultValue={filter}
            className={`${controlClass} min-h-nav-target`}
          >
            {(Object.keys(filterLabels) as YouthStudentFilter[]).map((id) => (
              <option key={id} value={id}>
                {filterLabels[id]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass('secondary')}>
          Apply
        </button>
      </AutoSubmitForm>
      <section
        aria-labelledby="youth-students-h"
        className="flex flex-col gap-2"
      >
        <h2 id="youth-students-h" className="font-display text-xl font-bold">
          Your Youth students
        </h2>
        <p className="text-sm text-ink-muted">
          Youth tournament entries appear here once Youth events open.
        </p>
        <ul className="flex flex-col rounded-xl border border-border bg-surface-raised">
          {rows.length === 0 ? (
            <li className="px-4 py-4 text-sm text-ink-muted">
              No Youth students match.
            </li>
          ) : null}
          {rows.map((row, index) => (
            <li
              key={row.userId}
              className={`grid grid-cols-club-row items-center gap-4 px-4 py-3 max-compact:grid-cols-1 max-compact:gap-2 ${index === 0 ? '' : 'border-t border-border'}`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={row.username ?? 'Student'} />
                <strong className="truncate font-strong">
                  {row.username === null ? 'A student' : `@${row.username}`}
                </strong>
              </span>
              <span>
                <Badge tone={releaseBadgeTone[row.badge]}>
                  {row.badgeText}
                </Badge>
              </span>
              <span className="text-sm">{row.recordings}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-sm text-ink-muted">
        Without a release a student’s Rounds stay private: they, their parent,
        you and their judges can watch. A Round with any unreleased Youth
        debater stays private for everyone in it.
      </p>
    </>
  );
}
