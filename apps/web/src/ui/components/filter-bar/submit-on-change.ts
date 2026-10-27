/** The slice of a form control the submit-on-change rule reads. */
export type ChangedControl = {
  readonly tagName: string;
  readonly type?: string;
  readonly form: { requestSubmit: () => void } | null;
};

/**
 * Selects and radios apply as soon as they change; a search field waits for
 * Enter or Apply so typing is never interrupted. Enhancement only: the form
 * is a plain GET without it.
 */
export function submitOnChange(control: ChangedControl): void {
  const applies =
    control.tagName === 'SELECT' ||
    (control.tagName === 'INPUT' && control.type === 'radio');
  if (applies) control.form?.requestSubmit();
}
