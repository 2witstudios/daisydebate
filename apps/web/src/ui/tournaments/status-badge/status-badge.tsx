import { statusLabel } from '../../../features/tournaments/labels';
import type { TournamentStatus } from '../../../features/tournaments/tournament';
import { Badge } from '../../components/badge/badge';
import type { BadgeTone } from '../../components/badge/badge-class';
import { StatusLine } from '../../components/status-line/status-line';

const tones: Readonly<Record<TournamentStatus, BadgeTone>> = {
  open: 'accent',
  'not-open': 'neutral',
  full: 'gold',
  closed: 'neutral',
  live: 'live',
  done: 'neutral',
};

/** The tone a status reads in. */
export const statusTone = (status: TournamentStatus): BadgeTone =>
  tones[status];

export function StatusBadge({ status }: { readonly status: TournamentStatus }) {
  return (
    <Badge tone={statusTone(status)}>
      {status === 'live' ? (
        <StatusLine tone="live">{statusLabel(status)}</StatusLine>
      ) : (
        statusLabel(status)
      )}
    </Badge>
  );
}
