type NavigationChoice = { readonly preventDefault: () => void };

/** Called by an actual Next Link's onNavigate, never inferred from a click. */
export function acceptShellNavigation(
  event: NavigationChoice,
  caller: ((event: NavigationChoice) => void) | undefined,
  accepted: () => void,
) {
  // The caller's choice lands in this record, through its preventDefault.
  const choice = { cancelled: false };
  caller?.({
    preventDefault: () => {
      choice.cancelled = true;
      event.preventDefault();
    },
  });
  if (!choice.cancelled) accepted();
}

/** Content-free same-document notice; it carries neither destination nor authority. */
export const shellNavigationEvent = 'daisy:shell-navigation-accepted';
