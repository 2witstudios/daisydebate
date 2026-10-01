import type {
  Hero as HeroModel,
  Pairing,
} from '../../../features/tournaments/event';
import { StatusLine } from '../../components/status-line/status-line';
import { DisabledAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { Notice } from '../notice/notice';
import { PairingCards } from './pairing-cards';

/** The one thing to do or know right now in the viewer's event. */
export function Hero({
  hero,
  pairing,
}: {
  readonly hero: HeroModel;
  readonly pairing: Pairing;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-xs font-bold tracking-widest text-accent uppercase">
          {hero.live ? (
            <StatusLine tone="live">{hero.eyebrow}</StatusLine>
          ) : (
            hero.eyebrow
          )}
        </p>
        {hero.note ? (
          <p className="text-sm text-ink-muted">{hero.note}</p>
        ) : null}
      </div>
      <h2 className="font-display text-2xl leading-tight font-bold tracking-tight">
        {hero.title}
      </h2>
      {hero.body ? (
        <p className="text-base text-ink-muted">{hero.body}</p>
      ) : null}
      {hero.showPairing ? <PairingCards pairing={pairing} /> : null}
      {hero.status ? <Notice icon="check">{hero.status}</Notice> : null}
      {hero.reason ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface-raised p-4">
          <p className="text-xs font-bold tracking-wider text-ink-faint uppercase">
            Reason for decision
          </p>
          <p className="text-base text-ink-muted">
            The judge’s written reason appears here once the judge submits it.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {hero.ctas.map((cta) =>
          cta.kind === 'link' ? (
            <LinkButton key={cta.href} href={cta.href} variant={cta.variant}>
              {cta.label}
            </LinkButton>
          ) : null,
        )}
        {hero.inert.map((item, index) => (
          <DisabledAction
            key={item.label}
            label={item.label}
            reason={item.reason}
            variant={index === 0 ? 'primary' : 'ghost'}
          />
        ))}
      </div>
    </section>
  );
}
