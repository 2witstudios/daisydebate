import type { ReactNode } from 'react';
import { trainDestinations } from '../../../features/train/actions';
import {
  debriefFields,
  type DebriefQuery,
} from '../../../features/train/debrief';
import type { PracticeConfig } from '../../../features/train/practice';
import type { HubQuery } from '../../../features/train/query';

export type DebriefContext = {
  readonly config: PracticeConfig;
  readonly plan: HubQuery;
  readonly query: DebriefQuery;
};

type Props = DebriefContext & {
  /** Whether the form carries the arguments already saved. */
  readonly keepSaved: boolean;
  readonly className: string;
  readonly children: ReactNode;
};

/** A GET form back to the debrief that keeps the rest of its state. */
export function DebriefForm({
  config,
  plan,
  query,
  keepSaved,
  className,
  children,
}: Props) {
  return (
    <form
      method="get"
      action={trainDestinations.practiceDebrief}
      className={className}
    >
      {debriefFields(config, plan, query, { saved: keepSaved }).map(
        ([name, value], index) => (
          <input
            key={`${name}-${index}`}
            type="hidden"
            name={name}
            value={value}
          />
        ),
      )}
      {children}
    </form>
  );
}
