type RouteShellProps = {
  readonly title: string;
  readonly lede: string;
  readonly planned: readonly string[];
};

/**
 * Presentation shell for product areas that have no implementation yet.
 * Replace it inside one owning feature when that area comes alive.
 */
export function RouteShell({ title, lede, planned }: RouteShellProps) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{lede}</p>
      <h2>Planned capabilities</h2>
      <ul>
        {planned.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
