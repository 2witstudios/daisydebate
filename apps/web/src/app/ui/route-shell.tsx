import { prose } from './prose-class';
type RouteShellProps = {
  readonly title: string;
};

/**
 * Presentation shell for product areas that have no implementation yet.
 * Replace it inside one owning feature when that area comes alive.
 */
export function RouteShell({ title }: RouteShellProps) {
  return (
    <section>
      <h1 className={prose.h1}>{title}</h1>
      <p className={prose.p}>Coming soon.</p>
    </section>
  );
}
