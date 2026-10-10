/** Shared native envelope only; canonical CAP validates every value again. */
export function AssemblyCommandFields({
  type,
  version,
  commandId,
}: {
  readonly type: string;
  readonly version: number;
  readonly commandId: string;
}) {
  return (
    <>
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="expectedVersion" value={String(version)} />
      <input type="hidden" name="commandId" value={commandId} />
    </>
  );
}
