import Link from 'next/link';
import { buttonClass } from '../components/button/button-class';

/** The inbox with no conversations yet: a title and the one action that starts one. */
export function InboxEmpty() {
  return (
    <section
      aria-labelledby="inbox-empty-heading"
      className="flex flex-col items-start gap-4 rounded-lg border border-dashed border-border-strong p-6"
    >
      <h2 id="inbox-empty-heading" className="font-display text-xl font-bold">
        No messages yet
      </h2>
      <Link href="/messages/new" className={buttonClass('primary')}>
        New message
      </Link>
    </section>
  );
}
