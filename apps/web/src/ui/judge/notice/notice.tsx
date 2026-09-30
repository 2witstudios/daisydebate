import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../components/icon/icon';
import { noticeClass, noticeIconClass, type NoticeTone } from './notice-class';

export type NoticeProps = {
  readonly tone: NoticeTone;
  readonly icon: IconName;
  readonly title: string;
  /** `status` when the notice appears as an answer to something the user did. */
  readonly role?: 'status';
  readonly children?: ReactNode;
};

/** A short callout: an icon, a bold line and an optional explanation. */
export function Notice({ tone, icon, title, role, children }: NoticeProps) {
  return (
    <div role={role} className={noticeClass(tone)}>
      <Icon name={icon} size={18} className={noticeIconClass(tone)} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-strong text-ink">{title}</p>
        {children ? (
          <p className="text-base leading-normal text-ink-muted">{children}</p>
        ) : null}
      </div>
    </div>
  );
}
