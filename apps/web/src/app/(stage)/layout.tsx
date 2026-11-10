/**
 * Pages a recorder renders, never a person: today the composited Round that
 * Egress streams and records (ADR 0107), and later each seat's POV and other
 * broadcast layouts. It renders no visitor features (no consent banner,
 * analytics, session refresh or draft privacy), because nothing on a
 * recording can answer them (ADR 0123). The boundary scan keeps them out.
 */
export default function StageLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <main>{children}</main>;
}
