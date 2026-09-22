'use client';

import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { Panel } from '../../components/panel/panel';
import { useUiState } from '../../store/store';
import { avatarSrc } from '../../assets';

export function ActivityFeed() {
  const activities = useUiState((state) => state.collections.activities);
  return (
    <Panel title="Recent Activity">
      <ul className="flex flex-col gap-4">
        {activities.map((activity) => (
          <li key={activity.headline} className="flex items-start gap-3">
            {activity.actor ? (
              <Avatar
                name={activity.actor}
                src={avatarSrc(activity.actor)}
                size="sm"
              />
            ) : (
              <span
                className="inline-flex size-activity-icon shrink-0 items-center justify-center rounded-round border border-gold-border bg-gold-soft text-gold"
                aria-hidden="true"
              >
                <Icon name="trophy" size={13} />
              </span>
            )}
            <span className="flex min-w-0 flex-col gap-activity-inset pt-activity-inset">
              <span className="text-sm leading-tight font-semibold text-ink">
                {activity.headline}
              </span>
              <span className="text-xs text-ink-muted tabular-nums">
                {activity.meta}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
