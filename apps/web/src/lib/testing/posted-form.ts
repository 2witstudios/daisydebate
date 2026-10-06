/**
 * A form as the browser posts it: every entry a string field, and a list
 * as one field per value, the way checkboxes sharing a name arrive.
 */
export const postedForm = (
  entries: Record<string, string | readonly string[]>,
): FormData => {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries))
    for (const item of typeof value === 'string' ? [value] : value)
      form.append(key, item);
  return form;
};
