import type { Cta, Panel } from '../../../features/tournaments/panel';
import { fillPercent, slotsLabel } from '../../../features/tournaments/labels';
import type { Tournament } from '../../../features/tournaments/tournament';
import { CheckList } from '../check-list/check-list';
import { FillBar } from '../fill-bar/fill-bar';
import { InertAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { Notice } from '../notice/notice';

function CtaButton({ cta }: { readonly cta: Cta }) {
  if (cta.kind === 'inert')
    return <InertAction id={cta.id} className="w-full" />;
  return (
    <LinkButton href={cta.href} variant={cta.variant} className="w-full">
      {cta.label}
    </LinkButton>
  );
}

/** The side card: where the viewer stands and the one next step. */
export function RegistrationPanel({
  panel,
  tournament,
}: {
  readonly panel: Panel;
  readonly tournament: Tournament;
}) {
  const left = tournament.places - tournament.entered;
  return (
    <aside
      aria-label="Registration"
      className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
    >
      <h2 className="text-md font-strong text-ink">{panel.headline}</h2>
      {panel.places ? (
        <div className="flex flex-col gap-2">
          <p className="flex justify-between text-sm text-ink-muted tabular-nums">
            <span>{`${slotsLabel(tournament)} places`}</span>
            <span>{left > 0 ? `${left} left` : 'Full'}</span>
          </p>
          <FillBar
            percent={fillPercent(tournament)}
            label={`${slotsLabel(tournament)} places taken`}
          />
        </div>
      ) : null}
      {panel.body ? (
        <p className="text-base text-ink-muted">{panel.body}</p>
      ) : null}
      {panel.checks.length > 0 ? <CheckList items={panel.checks} /> : null}
      {panel.callout ? <Notice icon="clock">{panel.callout}</Notice> : null}
      {panel.firstRound ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-bold tracking-wider text-ink-faint uppercase">
            Your first round
          </p>
          <p className="text-base text-ink">{panel.firstRound}</p>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        {panel.ctas.map((cta) => (
          <CtaButton key={cta.kind === 'link' ? cta.href : cta.id} cta={cta} />
        ))}
      </div>
    </aside>
  );
}
