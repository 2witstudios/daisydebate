import type { ReactNode } from 'react';
import { PrepIcon } from '../prep-icon/prep-icon';

/** The banner shown when the page loses its connection. Pure. */
export function renderPanelOffline(props: {
  readonly offline: boolean;
  readonly since: string;
  readonly retry: ReactNode;
}) {
  if (!props.offline) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-gold-border bg-gold-soft p-3 text-sm"
    >
      <p className="flex items-start gap-2">
        <PrepIcon name="warning" size={16} className="mt-1 text-gold" />
        <span>
          <strong className="block text-base">
            Prep cannot reach the server
          </strong>
          {`Read only, as of ${props.since}`}
        </span>
      </p>
      {props.retry}
    </div>
  );
}
