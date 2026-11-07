type NavigationChoice = { readonly preventDefault: () => void };

/** Called by an actual Next Link's onNavigate, never inferred from a click. */
export function acceptShellNavigation(
  event: NavigationChoice,
  caller: ((event: NavigationChoice) => void) | undefined,
  accepted: () => void,
) {
  let cancelled = false;
  caller?.({
    preventDefault: () => {
      cancelled = true;
      event.preventDefault();
    },
  });
  if (!cancelled) accepted();
}

/** Content-free same-document notice; it carries neither destination nor authority. */
export const shellNavigationEvent = 'daisy:shell-navigation-accepted';
