import type { ModerationNotice } from '@daisy/protocol';
import { Button } from '../components/button/button';
import { Notice } from '../components/notice/notice';

/** A moderator's warning, shown on every page until the member has read it. */
export function ModerationNotices({
  notices,
  acknowledge,
}: {
  readonly notices: readonly ModerationNotice[];
  readonly acknowledge: (form: FormData) => Promise<void>;
}) {
  return notices.map((notice) => (
    <div key={notice.id} className="mx-6 mt-4 flex flex-col gap-2">
      <Notice
        tone="gold"
        icon="alert"
        title="A moderator warned you after a report."
        role="status"
      />
      <form action={acknowledge}>
        <input type="hidden" name="id" value={notice.id} />
        <Button type="submit" variant="secondary">
          Got it
        </Button>
      </form>
    </div>
  ));
}
