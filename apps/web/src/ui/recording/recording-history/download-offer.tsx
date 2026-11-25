'use client';

import { useState } from 'react';
import { Button } from '../../components/button/button';
import { UpgradePanel } from '../../components/upgrade-panel/upgrade-panel';
import { card, label } from './card-class';

/**
 * The download control for an account that may watch this video and lacks
 * only the download entitlement: reaching for it shows the upgrade panel in
 * place, and nothing is requested.
 */
export function DownloadOffer() {
  // Each reach mounts a fresh panel, so it shows again after "Not now".
  const [reaches, setReaches] = useState(0);
  return (
    <section aria-label="Download" className={card}>
      <span className={label}>Download</span>
      <Button
        variant="secondary"
        type="button"
        className="self-start"
        onClick={() => setReaches((count) => count + 1)}
      >
        Download video
      </Button>
      {reaches > 0 ? (
        <UpgradePanel
          key={reaches}
          title="Downloading is Premium"
          alternative={{ kind: 'dismiss', label: 'Not now' }}
        >
          You can still watch this recording here.
        </UpgradePanel>
      ) : null}
    </section>
  );
}
