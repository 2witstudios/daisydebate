import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icon/icon';
import { Announcement } from '../announcement/announcement';
import { noticeClass, noticeIconClass, type NoticeTone } from './notice-class';

export type NoticeProps = {
  readonly tone: NoticeTone;
  readonly icon: IconName;
  readonly title: string;
  /** Announced as progress when it appears as an answer to something the member did. */
  readonly announced?: boolean;
  readonly children?: ReactNode;
};

/** A short callout: an icon, a bold line and an optional explanation. */
export function Notice({
  tone,
  icon,
  title,
  announced = false,
  children,
}: NoticeProps) {
  const body = (
    <>
      <Icon name={icon} size={18} className={noticeIconClass(tone)} />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-strong text-ink">{title}</p>
        {children ? (
          <p className="text-base leading-normal text-ink-muted">{children}</p>
        ) : null}
      </div>
    </>
  );
  return announced ? (
    <Announcement as="div" kind="progress" className={noticeClass(tone)}>
      {body}
    </Announcement>
  ) : (
    <div className={noticeClass(tone)}>{body}</div>
  );
}
