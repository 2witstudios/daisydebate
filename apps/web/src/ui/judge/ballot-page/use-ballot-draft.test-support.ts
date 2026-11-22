import { createElement } from 'react';
import type { RoundBallotRead } from '@daisy/protocol/round-ballot-read';
import type { BallotDisplay } from '../../../features/round-ballots/presentation';
import { useBallotDraft } from './use-ballot-draft';
import { sampleBallotPlan } from '../../mock/judge.test-support';

export { act, createElement } from 'react';
export { createRoot } from 'react-dom/client';

/** Renders what the hook hands the ballot's fields. */
export function DraftProbe(props: {
  readonly view: RoundBallotRead;
  readonly display: BallotDisplay;
  readonly posted: Readonly<Record<string, string>>;
}) {
  const draft = useBallotDraft(
    sampleBallotPlan,
    props.view,
    props.display,
    props.posted,
  );
  return createElement(
    'output',
    null,
    JSON.stringify({ restored: draft.restored, values: draft.values }),
  );
}
