/**
 * One control on a Tab screen. With an address it is a link; with none there
 * is no operation behind it yet, and the screen answers with the shell's
 * sample-action banner.
 */
export type TabAction = {
  readonly label: string;
  readonly href: string | null;
  readonly primary: boolean;
};

export const linkTo = (
  label: string,
  href: string,
  primary = false,
): TabAction => ({ label, href, primary });

export const sampleAction = (label: string, primary = false): TabAction => ({
  label,
  href: null,
  primary,
});

/** A select as a screen draws it: the chosen option first among its options. */
export type Choice = {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly helper: string | null;
};

export const choice = (
  label: string,
  options: readonly [string, ...string[]],
  helper: string | null = null,
): Choice => ({ label, value: options[0], options, helper });
