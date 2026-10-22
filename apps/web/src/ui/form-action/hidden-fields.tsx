/** Render only fields selected by the owning strict envelope parser/controller. */
export function HiddenFields({
  entries,
}: {
  readonly entries: readonly (readonly [string, string])[];
}) {
  return entries.map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
}
