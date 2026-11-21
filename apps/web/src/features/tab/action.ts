/** A control carries the address or command that the screen offers. */
export type TabAction<Command = never> = {
  readonly label: string;
  readonly primary: boolean;
} & (
  | { readonly kind: 'link'; readonly href: string }
  | { readonly kind: 'unavailable' }
  | ([Command] extends [never]
      ? never
      : { readonly kind: 'command'; readonly command: Command })
);

export const commandAction = <Command>(
  label: string,
  command: Command,
  primary = false,
): CommandAction<Command> => ({ kind: 'command', label, command, primary });

export type CommandAction<Command> = {
  readonly kind: 'command';
  readonly label: string;
  readonly primary: boolean;
  readonly command: Command;
};

export const linkTo = (
  label: string,
  href: string,
  primary = false,
): Extract<TabAction, { kind: 'link' }> => ({
  kind: 'link',
  label,
  href,
  primary,
});

export const unavailableAction = (
  label: string,
  primary = false,
): TabAction => ({
  kind: 'unavailable',
  label,
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
