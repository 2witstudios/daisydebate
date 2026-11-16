const walk = '/tournaments/walk';

/** Preview navigation never claims a production address. */
export const walkHref = (href: string): string => {
  if (
    href === walk ||
    href.startsWith(`${walk}/`) ||
    href.startsWith(`${walk}?`)
  )
    return href;
  if (
    !/^\/(?:host(?:[/?]|$)|tournaments(?:[/?]|$)|leagues(?:[/?]|$)|family(?:[/?]|$)|rooms\/sample\/)/.test(
      href,
    )
  )
    return href;
  if (href === '/tournaments' || href.startsWith('/tournaments?'))
    return href.replace('/tournaments', `${walk}/directory`);
  return `${walk}${href}`;
};
