'use client';

import { useState, type ReactNode } from 'react';
import { petalShape } from '../../../ui/brand/brand-geometry';
import type { PetalShape } from '../../../ui/brand/petal';
import { cn } from '../../../ui/cn';
import {
  DaisyMark,
  DaisyTile,
} from '../../../ui/components/daisy-mark/daisy-mark';
import { OpposingPetals } from '../../../ui/components/daisy-mark/opposing-petals';
import { prose } from '../../ui/prose-class';
import { shapeControls, tuneShape } from './shape-controls';

function Specimen({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <figure className="m-0 flex flex-col items-center gap-2">
      {children}
      <figcaption className="text-xs tracking-wider text-ink-muted uppercase">
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * Every brand renderer in one colour scheme. The panel pins its scheme with
 * a preview-scheme utility, the one sanctioned exception to <html
 * data-theme> owning color-scheme (ADR 0045), so both schemes sit side by
 * side while every token still resolves through light-dark().
 */
function SchemePanel({
  scheme,
  shape,
}: {
  readonly scheme: 'light' | 'dark';
  readonly shape: PetalShape;
}) {
  return (
    <section
      aria-label={`${scheme === 'light' ? 'Light' : 'Dark'} scheme`}
      className={cn(
        'flex flex-col gap-6 rounded-xl border border-border p-8',
        scheme === 'light' ? 'preview-scheme-light' : 'preview-scheme-dark',
      )}
    >
      <p className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        {scheme === 'light' ? 'Light · cream' : 'Dark · forest'}
      </p>
      <div className="flex flex-wrap items-end gap-8">
        <Specimen label="Primary">
          <DaisyMark size={112} variant="primary" shape={shape} />
        </Specimen>
        <Specimen label="Mono">
          <DaisyMark
            size={112}
            variant="mono"
            shape={shape}
            className="text-ink"
          />
        </Specimen>
        <Specimen label="Reverse">
          <span className="flex rounded-lg bg-surface-stage p-4">
            <DaisyMark size={80} variant="reverse" shape={shape} />
          </span>
        </Specimen>
        <Specimen label="Tile">
          <DaisyTile size={80} shape={shape} />
        </Specimen>
        <Specimen label="Favicon 16px">
          <DaisyTile size={16} shape={shape} />
        </Specimen>
        <Specimen label="Opposing petals">
          <OpposingPetals size={128} shape={shape} />
        </Specimen>
      </div>
    </section>
  );
}

export type BrandSheetViewProps = {
  readonly shape: PetalShape;
  readonly onTune: (key: keyof PetalShape, raw: string) => void;
  readonly onReset: () => void;
};

export function BrandSheetView({
  shape,
  onTune,
  onReset,
}: BrandSheetViewProps) {
  return (
    <section aria-labelledby="brand-sheet" className="flex flex-col gap-6">
      <h2 id="brand-sheet" className={prose.h2}>
        Brand sheet
      </h2>
      <p className={prose.p}>
        The Daisy marks drawn from the petal primitive (ADR 0045), in both
        schemes. The sliders preview other petal shapes; what ships is{' '}
        <code className={prose.code}>ui/brand/brand-geometry.ts</code>, and the
        sheet opens on it.
      </p>
      <fieldset className="flex flex-wrap items-end gap-6 rounded-xl border border-border p-6">
        <legend className="px-2 text-sm font-semibold">Petal shape</legend>
        {shapeControls.map(({ key, label, min, max, step }) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            <span>
              {label}: <output>{shape[key]}</output>
            </span>
            <input
              type="range"
              name={key}
              min={min}
              max={max}
              step={step}
              value={shape[key]}
              className="accent-accent"
              onChange={(event) => onTune(key, event.currentTarget.value)}
            />
          </label>
        ))}
        <button
          type="button"
          onClick={onReset}
          className="rounded-sm border border-border-strong px-4 py-2 text-sm font-semibold"
        >
          Reset to committed
        </button>
      </fieldset>
      <div className="flex flex-col gap-6">
        <SchemePanel scheme="light" shape={shape} />
        <SchemePanel scheme="dark" shape={shape} />
      </div>
    </section>
  );
}

/** The brand sheet with its tuning state; it opens on the committed shape. */
export function BrandSheet() {
  const [shape, setShape] = useState<PetalShape>(petalShape);
  return (
    <BrandSheetView
      shape={shape}
      onTune={(key, raw) => setShape((current) => tuneShape(current, key, raw))}
      onReset={() => setShape(petalShape)}
    />
  );
}
