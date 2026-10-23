export function RoundAttendanceForm({
  roundId,
  segmentId,
  commandId,
}: {
  readonly roundId: string;
  readonly segmentId: string;
  readonly commandId: string;
}) {
  return (
    <form method="post" action={`/api/rounds/${roundId}/check-in`}>
      <input type="hidden" name="version" value="1" />
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="segmentId" value={segmentId} />
      <button type="submit">Record attendance for this speech</button>
      <p>
        Submit when this speech opens. The response confirms whether attendance
        was recorded.
      </p>
    </form>
  );
}
