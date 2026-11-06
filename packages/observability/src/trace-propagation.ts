import { routinePathname } from './trace-sampling';
/** Full trusted-origin boundary; routine requests cannot seed downstream traces. */
export function tracePropagationTargets(origin: string | undefined): RegExp[] {
  if (!origin) return [];
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return [];
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    return [];
  return [
    new RegExp(
      `^${url.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=/|$)(?!${routinePathname}(?:[/?#]|$)|/api/auth/get-session(?:[/?#]|$))`,
    ),
  ];
}
