import {
  certificateText,
  type Certificate as CertificateModel,
} from '../../../features/tournaments/results';
import type { Tournament } from '../../../features/tournaments/tournament';
import { DaisyMark } from '../../components/daisy-mark/daisy-mark';

/**
 * A certificate of recognition as a page element, to read on screen or print
 * from the browser. No file is generated; the id and verification link are
 * samples until certificates are issued.
 */
export function Certificate({
  tournament,
  certificate,
}: {
  readonly tournament: Tournament;
  readonly certificate: CertificateModel;
}) {
  return (
    <article
      aria-label="Certificate of recognition"
      className="flex flex-col items-center gap-5 rounded-xl border-3 border-gold-border bg-surface-raised p-10 text-center shadow-1 max-compact:p-6"
    >
      <DaisyMark size={56} variant="primary" />
      <p className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Daisy Debate
      </p>
      <h2 className="font-display text-2xl leading-tight font-bold tracking-tight text-ink">
        Certificate of Recognition
      </h2>
      <p className="text-base text-ink-muted">This certifies that</p>
      <p className="font-display text-3xl font-bold text-ink">{`@${certificate.recipient}`}</p>
      <p className="max-w-prose text-base text-ink-muted">
        {certificateText(tournament, certificate)}
      </p>
      <div className="flex w-full flex-wrap justify-between gap-4 border-t border-border pt-4 text-sm text-ink-muted">
        <p>{`${certificate.organizer}, organizer`}</p>
        <p>{`Certificate ${certificate.id} (sample). Verification link to come.`}</p>
      </div>
    </article>
  );
}
