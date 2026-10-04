import Link from 'next/link';
import type { LiveLinks } from '../../../features/train/live-links';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { Modal } from '../modal/modal';

const link = 'no-underline hover:no-underline';

/** The End debate confirmation, rendered from the URL so it needs no script. */
export function EndDialog({ links }: { readonly links: LiveLinks }) {
  return (
    <Modal
      label="End this debate"
      title="End this debate?"
      actions={
        <>
          <Link
            href={links.endNow}
            className={cn(buttonClass('primary'), link)}
          >
            End and see debrief
          </Link>
          <Link
            href={links.keepGoing}
            className={cn(buttonClass('secondary'), link)}
          >
            Keep going
          </Link>
        </>
      }
    />
  );
}
