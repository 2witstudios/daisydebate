import type { AccessibleView } from '../../test-support/rendered/accessible';

/**
 * Test support: what a form posts, found from the submit button a person
 * would press. Hidden inputs have no role, so a test reaches the command a
 * form sends through its button's form: every named field, by name, with
 * the value it posts. A form inside a closed dialog is asked for with
 * `{ hidden: true }`.
 */
export const postedBy = (
  view: AccessibleView,
  button: string | RegExp,
  states: Parameters<AccessibleView['get']>[2] = {},
): Readonly<Record<string, string>> => {
  const form = (view.get('button', button, states) as HTMLButtonElement).form;
  if (!form)
    throw new Error(`The button named ${String(button)} posts no form`);
  return Object.fromEntries(
    [...form.elements].flatMap((element) => {
      const name = element.getAttribute('name');
      return name ? [[name, (element as HTMLInputElement).value]] : [];
    }),
  );
};

/** Whether any button in the view submits a form: a page that sends no command has none. */
export const postsAnyForm = (view: AccessibleView): boolean =>
  view.all('button').some((button) => (button as HTMLButtonElement).form);
