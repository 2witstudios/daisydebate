import { Announcement } from '../components/announcement/announcement';
/** Creation and message forms keep drafts when a protected mutation is refused. */
export function DraftNotice({
  id,
  notice,
}: {
  readonly id: string;
  readonly notice: string | undefined;
}) {
  return notice ? (
    <Announcement
      as="p"
      id={id}
      kind="progress"
      tabIndex={-1}
      className="text-sm text-ink-muted"
    >
      {notice}
    </Announcement>
  ) : null;
}
