/** Creation and message forms keep drafts when a protected mutation is refused. */
export function DraftNotice({
  id,
  notice,
}: {
  readonly id: string;
  readonly notice: string | undefined;
}) {
  return notice ? (
    <p id={id} role="status" tabIndex={-1} className="text-sm text-ink-muted">
      {notice}
    </p>
  ) : null;
}
