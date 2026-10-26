/**
 * The confirm pages' brand panel, matching the app's AuthFrame: the overlay
 * surface in page ink, with a tonal primary Daisy mark as art. Part of
 * `confirmPageStylesheet`, which declares the `--af-*` tokens it reads.
 */
export const confirmPanelStyles = `.af-panel {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  width: 500px;
  flex-shrink: 0;
  border-radius: 16px;
  background: var(--af-surface-overlay);
  color: var(--af-ink);
  padding: 40px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 14px;
}

.af-panel-mark {
  position: absolute;
  top: -140px;
  right: -160px;
  width: 520px;
  height: 520px;
  z-index: -1;
}

/* Pre-mixed colours, not opacity: some engines rasterize a large,
   opacity-composited replaced element with a faint off-color box behind it
   (visible on Linux, not on macOS Chromium). Painting the already-blended
   colours directly has no layer to composite, so there is nothing to show
   through. */
.af-panel-cardinal {
  fill: color-mix(in srgb, var(--af-mark-cardinal) 20%, var(--af-surface-overlay));
}

.af-panel-diagonal {
  fill: color-mix(in srgb, var(--af-mark-diagonal) 20%, var(--af-surface-overlay));
}

.af-panel-disc {
  fill: color-mix(in srgb, var(--af-yolk) 20%, var(--af-surface-overlay));
}

.af-panel-kicker {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--af-ink-muted);
}

.af-panel-title {
  margin: 0;
  font-family: var(--af-font-display);
  font-weight: 600;
  font-size: 1.9rem;
  line-height: 1.15;
  letter-spacing: -0.02em;
  text-wrap: balance;
}`;
