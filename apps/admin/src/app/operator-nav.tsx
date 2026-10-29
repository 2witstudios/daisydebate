import Link from 'next/link';
import { signOutAction } from './actions';

export type Section = 'accounts' | 'audit' | 'security';

const petals = [0, 60, 120, 180, 240, 300];

/** The Daisy mark, drawn here: the admin app does not import apps/web. The
    petals alternate forest and sage; the disc is yolk. */
export function DaisyMark({ size = 26 }: { readonly size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      {petals.map((angle, index) => (
        <ellipse
          key={angle}
          cx="20"
          cy="9"
          rx="5"
          ry="9"
          className={index % 2 === 0 ? 'mark-forest' : 'mark-sage'}
          transform={`rotate(${angle} 20 20)`}
        />
      ))}
      <circle cx="20" cy="20" r="6" className="mark-yolk" />
    </svg>
  );
}

/** The signed-in header; sign-out is a plain POST form. */
export function OperatorNav({
  name,
  current,
}: {
  readonly name: string;
  readonly current: Section;
}) {
  const link = (section: Section, href: string, label: string) => (
    <Link href={href} aria-current={section === current ? 'page' : undefined}>
      {label}
    </Link>
  );
  return (
    <header className="site-header">
      <Link href="/accounts" className="site-brand" aria-label="Daisy operator">
        <DaisyMark />
        <span>Operator</span>
      </Link>
      <nav aria-label="Admin" className="site-sections">
        {link('accounts', '/accounts', 'Accounts')}
        {link('audit', '/audit', 'Audit')}
        {link('security', '/security', 'Security')}
      </nav>
      <div className="site-operator">
        <span className="muted">{name}</span>
        <form action={signOutAction}>
          <button type="submit">Sign out</button>
        </form>
      </div>
    </header>
  );
}

export function NotPermitted() {
  return <p>Your operator role does not permit this page.</p>;
}
