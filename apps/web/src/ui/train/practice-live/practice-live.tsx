import Link from 'next/link';
import type { SpeechView } from '../../../features/train/live';
import type { LiveLinks, LiveQuery } from '../../../features/train/live-links';
import { Badge } from '../../components/badge/badge';
import { BackLink } from '../back-link/back-link';
import { TrainCard } from '../card/train-card';
import { TurnList } from '../turn-list/turn-list';
import { TrainColumns, TrainPage } from '../train-page/train-page';
import { CoachCard } from './coach-card';
import { EndDialog } from './end-dialog';
import { SpeechCard } from './speech-card';
import { TranscriptCard } from './transcript-card';

export type PracticeLiveProps = {
  readonly view: SpeechView;
  readonly links: LiveLinks;
  readonly query: LiveQuery;
};

/**
 * A practice turn: the timer and controls, the transcript, the coach and the
 * debate's turns. The timer is the only client state; every other step is a
 * link, so the screen works with no script.
 */
export function PracticeLive({ view, links, query }: PracticeLiveProps) {
  return (
    <TrainPage>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BackLink href={links.leave}>Leave practice</BackLink>
        <Badge tone="accent">{view.youAre}</Badge>
        <span className="min-w-0 text-base text-ink-muted">{`Motion: ${view.motion}`}</span>
      </div>
      <TrainColumns
        asideLabel="Practice guide"
        main={
          <>
            <SpeechCard view={view} links={links} query={query} />
            <TranscriptCard view={view} />
          </>
        }
        aside={
          <>
            <CoachCard view={view} hintOpen={query.hint} />
            <TurnList
              rows={view.rows}
              note="The number of turns and speech length come from the rules."
              footer={{ label: 'Prep time left', value: view.prepLabel }}
            />
            <TrainCard title="AI debater" level={3}>
              <p className="text-sm text-ink-muted">{view.opponentNote}</p>
              {links.reportProblem !== null ? (
                <Link
                  href={links.reportProblem}
                  className="text-sm font-strong text-ink-muted"
                >
                  Report a problem with the opponent
                </Link>
              ) : null}
            </TrainCard>
          </>
        }
      />
      {query.confirmEnd ? <EndDialog links={links} /> : null}
    </TrainPage>
  );
}
