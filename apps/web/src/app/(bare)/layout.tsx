import { VisitorFeatures } from '../visitor-features';

/**
 * The unstyled document routes outside the product shell (auth entry, the
 * gated foundation proof): no header, nav or rail, just the single main
 * landmark the root layout no longer owns, and the visitor features every
 * page a person uses carries (ADR 0123).
 */
export default function BareLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <main>{children}</main>
      <VisitorFeatures />
    </>
  );
}
