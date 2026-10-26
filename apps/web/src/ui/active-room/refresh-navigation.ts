/** Reread retained shell membership once for each client navigation. */
export function activeRoomNavigation(refresh: () => void) {
  let previous: string | null = null;
  return (pathname: string | null) => {
    if (pathname === null || pathname === previous) return;
    previous = pathname;
    refresh();
  };
}
