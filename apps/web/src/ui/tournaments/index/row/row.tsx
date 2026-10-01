import {
  fillPercent,
  metaLabel,
  mineLabel,
  rowAction,
  rulesLabel,
  slotsLabel,
  structureLabel,
  whenLabel,
} from '../../../../features/tournaments/labels';
import type { TournamentRow } from '../../../../features/tournaments/list-tournaments';
import { statusOf } from '../../../../features/tournaments/tournament';
import { tournamentRoutes } from '../../../../features/tournaments/routes';
import Link from 'next/link';
import { Icon } from '../../../components/icon/icon';
import { cn } from '../../../cn';
import { FillBar } from '../../fill-bar/fill-bar';
import { InertAction } from '../../inert-action/inert-action';
import { LinkButton } from '../../link-button/link-button';
import { StatusBadge } from '../../status-badge/status-badge';
import { rowColumnClass, rowGridClass } from './row-class';

function Action({ row }: { readonly row: TournamentRow }) {
  const action = rowAction(row.tournament, row.entry);
  const className = 'w-full whitespace-nowrap';
  if (action.kind === 'inert')
    return <InertAction id={action.id} className={className} />;
  return (
    <LinkButton
      href={action.href}
      variant={action.primary ? 'primary' : 'secondary'}
      className={className}
    >
      {action.label}
    </LinkButton>
  );
}

/** One tournament: name and status, when, places, and its single action. */
export function Row({ row }: { readonly row: TournamentRow }) {
  const { tournament, entry } = row;
  const mine = mineLabel(entry);
  const status = statusOf(tournament);
  return (
    <li
      className={cn(
        rowGridClass,
        'min-h-16 border-t border-border px-5 py-3 max-compact:px-4',
      )}
    >
      <div className={cn(rowColumnClass('name'), 'flex flex-col gap-1')}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={tournamentRoutes.detail(tournament.id)}
            className="truncate text-md font-strong text-ink"
          >
            {tournament.name}
          </Link>
          <StatusBadge status={status} />
        </div>
        <p className="text-sm text-ink-muted">
          {structureLabel(tournament.structure)} ·{' '}
          {rulesLabel(tournament.rules)}
        </p>
        {mine ? (
          <p className="flex items-center gap-1 text-sm font-strong text-accent">
            <Icon name="check" size={15} />
            {mine}
          </p>
        ) : null}
      </div>
      <div className={cn(rowColumnClass('when'), 'flex flex-col gap-1')}>
        <p className="text-base text-ink">{whenLabel(tournament)}</p>
        <p className="text-sm text-ink-muted">{metaLabel(tournament)}</p>
      </div>
      <div className={cn(rowColumnClass('slots'), 'flex flex-col gap-2')}>
        <p className="text-base text-ink tabular-nums">
          {slotsLabel(tournament)}
        </p>
        {status === 'done' ? null : (
          <FillBar
            percent={fillPercent(tournament)}
            label={`${slotsLabel(tournament)} places taken`}
          />
        )}
      </div>
      <div className={rowColumnClass('action')}>
        <Action row={row} />
      </div>
    </li>
  );
}
