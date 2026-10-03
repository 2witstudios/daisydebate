/** A form as the browser posts it: every entry a string field. */
export const postedForm = (entries: Record<string, string>): FormData => {
  const form = new FormData();
  for (const [key, value] of Object.entries(entries)) form.set(key, value);
  return form;
};
