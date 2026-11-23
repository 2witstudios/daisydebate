'use client';

import { Announcement } from '../components/announcement/announcement';
import { Button } from '../components/button/button';
/** The Round is live in another tab of this browser; only an explicit press moves it. */
export function TabElsewhere({ takeOver }: { readonly takeOver: () => void }) {
  return (
    <>
      <Announcement as="p" kind="progress">
        This Round is open in another tab.
      </Announcement>
      <Button variant="unstyled" type="button" onClick={takeOver}>
        Use this tab
      </Button>
    </>
  );
}
