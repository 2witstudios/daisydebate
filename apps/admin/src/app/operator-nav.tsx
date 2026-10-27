import Link from 'next/link';
import { signOutAction } from './actions';

/** The signed-in header; sign-out is a plain POST form. */
export function OperatorNav({ name }: { readonly name: string }) {
  return (
    <nav aria-label="Admin">
      <Link href="/accounts">Accounts</Link>
      <Link href="/audit">Audit</Link>
      <Link href="/security">Security</Link>
      <form action={signOutAction}>
        <span className="muted">{name} </span>
        <button type="submit">Sign out</button>
      </form>
    </nav>
  );
}

export function NotPermitted() {
  return <p>Your operator role does not permit this page.</p>;
}
