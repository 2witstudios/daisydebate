import type { ReactNode } from 'react';

export type LinkFormTarget = {
  readonly action: string;
  /** `post` for the real confirm route; the mock previews navigate by `get`. */
  readonly method: 'get' | 'post';
  /** Hidden fields the route needs back: token, callbackURL, intent. */
  readonly fields: Readonly<Record<string, string>>;
};

/**
 * A script-free form that posts to the emailed-link route, so these steps
 * work before (and without) hydration, like the confirm route itself.
 */
export function LinkForm({
  target,
  className,
  children,
}: {
  readonly target: LinkFormTarget;
  readonly className: string;
  readonly children: ReactNode;
}) {
  return (
    <form action={target.action} method={target.method} className={className}>
      {Object.entries(target.fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}
