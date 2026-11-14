import {
  sourceLabel,
  type ResolvedSetting,
} from '../../../features/tab/settings';
import { ActionLink } from '../action-control/action-control';
import { ListRow } from '../list-card/list-card';

/**
 * One resolved setting: its value, the scope it comes from, and a lock where
 * a scope above enforces it. Every screen that shows a setting draws this row.
 */
export function SettingRow({
  setting,
  selected = false,
}: {
  readonly setting: ResolvedSetting;
  readonly selected?: boolean;
}) {
  return (
    <ListRow
      title={setting.label}
      tone={selected ? 'selected' : 'plain'}
      detail={
        <>
          {setting.value} · {sourceLabel(setting)}
          {setting.attention === null ? null : (
            <strong className="font-strong text-live">
              {' '}
              · {setting.attention}
            </strong>
          )}
        </>
      }
      trailing={
        setting.control.kind === 'locked' ? (
          <span className="text-sm text-ink-muted">Locked</span>
        ) : setting.control.edit === null ? null : selected ? (
          <span className="text-sm font-strong">Open</span>
        ) : (
          <ActionLink action={setting.control.edit} about={setting.label} />
        )
      }
    />
  );
}
