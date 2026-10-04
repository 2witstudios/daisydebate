import { signInHref } from '../../../../features/access/decision';
import {
  fillPercent,
  rulesLabel,
  slotsLabel,
  structureLabel,
  whenLabel,
} from '../../../../features/tournaments/labels';
import type { TournamentRow } from '../../../../features/tournaments/list-tournaments';
import { tournamentRoutes } from '../../../../features/tournaments/routes';
import { FillBar } from '../../fill-bar/fill-bar';
import Link from 'next/link';
import { stageButtonClass } from './stage-button-class';
import { BracketArt } from './bracket-art';

/** The highlighted open tournament, in the stage colors. */
export function FeaturedTournament({
  row,
  signedIn,
}: {
  readonly row: TournamentRow;
  readonly signedIn: boolean;
}) {
  const { tournament, entry } = row;
  const detail = tournamentRoutes.detail(tournament.id);
  const enter = tournamentRoutes.enter(tournament.id);
  return (
    <section
      aria-label="Featured tournament"
      className="flex items-center justify-between gap-8 overflow-hidden rounded-xl bg-surface-stage p-8 text-stage-ink shadow-1 max-compact:p-5"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-xs font-bold tracking-widest text-stage-accent uppercase">
          Featured tournament
        </p>
        <h2 className="font-display text-2xl leading-tight font-bold tracking-tight">
          {tournament.name}
        </h2>
        <p className="max-w-prose text-base text-stage-ink-muted">
          {`${structureLabel(tournament.structure)}, ${rulesLabel(tournament.rules).toLowerCase()}, ${tournament.places} places. ${whenLabel(tournament)}.`}
        </p>
        <div className="flex max-w-rail flex-col gap-2 text-sm text-stage-ink-muted">
          <FillBar
            percent={fillPercent(tournament)}
            label={`${slotsLabel(tournament)} places taken`}
            tone="stage"
          />
          <p>{`${slotsLabel(tournament)} entered.`}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {entry ? null : (
            <Link
              href={signedIn ? enter : signInHref(enter)}
              className={stageButtonClass('primary')}
            >
              {signedIn ? 'Register' : 'Sign in to register'}
            </Link>
          )}
          <Link href={detail} className={stageButtonClass('secondary')}>
            See details
          </Link>
        </div>
      </div>
      <div className="shrink-0 max-compact:hidden">
        <BracketArt />
      </div>
    </section>
  );
}
