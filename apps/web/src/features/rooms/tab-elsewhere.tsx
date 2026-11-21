'use client';

import { StatusRegion } from '../../ui/components/status-region/status-region';
import { Button } from '../../ui/components/button/button';
/** The Round is live in another tab of this browser; only an explicit press moves it. */
export function TabElsewhere({ takeOver }: { readonly takeOver: () => void }) {
  return (
    <>
      <StatusRegion as="p" role="status">
        This Round is open in another tab.
      </StatusRegion>
      <Button variant="unstyled" type="button" onClick={takeOver}>
        Use this tab
      </Button>
    </>
  );
}
