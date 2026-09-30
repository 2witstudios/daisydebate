import Link from 'next/link';
import type { Notice, NoticeAction } from '../../../features/prep/notices';
import { buttonClass } from '../../components/button/button-class';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import {
  dangerButtonClass,
  stateAlertClass,
  stateIconClass,
} from './state-alert-class';

const link = 'no-underline hover:no-underline';

const toneSymbol = {
  danger: 'warning',
  warning: 'warning',
  info: 'info',
} as const;

function ActionButton({ action }: { readonly action: NoticeAction }) {
  const classes =
    action.variant === 'danger'
      ? dangerButtonClass
      : buttonClass(action.variant);
  if (action.href === undefined)
    return (
      <InertActionButton
        action={{
          label: action.label,
          reason: `${action.label} needs the Prep service, which is not built yet.`,
        }}
        variant={action.variant === 'danger' ? 'secondary' : action.variant}
        className={action.variant === 'danger' ? dangerButtonClass : ''}
        {...(action.symbol === undefined ? {} : { symbol: action.symbol })}
      />
    );
  return (
    <Link href={action.href} className={`${classes} ${link}`}>
      {action.symbol === undefined ? null : (
        <PrepIcon name={action.symbol} size={18} />
      )}
      {action.label}
    </Link>
  );
}

/**
 * An alert in context: a tinted box with an icon, a title, what happened and
 * what to do next. Failures are announced (role alert); the rest are status.
 */
export function StateAlert({ notice }: { readonly notice: Notice }) {
  return (
    <div
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      className={stateAlertClass(notice.tone)}
    >
      <PrepIcon
        name={toneSymbol[notice.tone]}
        size={20}
        className={`mt-1 ${stateIconClass(notice.tone)}`}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-base font-bold">{notice.title}</p>
          <p className="text-sm text-ink-muted">{notice.body}</p>
        </div>
        {notice.actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {notice.actions.map((action) => (
              <ActionButton key={action.label} action={action} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
