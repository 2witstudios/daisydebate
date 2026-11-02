import type { SharePanel as Model } from '../../../features/watch/replay-panels';
import { Badge } from '../../components/badge/badge';
import { CopyLink } from '../copy-link/copy-link';

export type SharePanelProps = {
  readonly share: Model;
};

/** Who can replay, which follows the Room, and the link to share. */
export function SharePanel({ share }: SharePanelProps) {
  return (
    <section
      aria-label="Sharing"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1"
    >
      <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Share and visibility
      </span>
      <div>
        <Badge tone={share.visibility === 'Private' ? 'gold' : 'accent'}>
          {share.visibility}
        </Badge>
      </div>
      <p className="text-sm text-ink-muted">{share.description}</p>
      <div>
        <CopyLink path={share.linkPath} />
      </div>
    </section>
  );
}
