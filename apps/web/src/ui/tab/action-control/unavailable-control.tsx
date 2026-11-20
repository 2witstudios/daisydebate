'use client';
import type { ReactNode } from 'react';
import { useRoutedPathname } from '../../components/sample-action/router-location';
import { SampleAction } from '../../components/sample-action/sample-action';
export function UnavailableControl({
  label,
  className,
  ariaLabel,
  children,
}: {
  readonly label: string;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly children: ReactNode;
}) {
  const pathname = useRoutedPathname();
  if (!pathname?.startsWith('/tournaments/walk'))
    return (
      <button
        type="button"
        disabled
        className={className}
        aria-label={ariaLabel}
      >
        {children}
      </button>
    );
  return (
    <SampleAction
      label={label}
      {...(className === undefined ? {} : { className })}
      {...(ariaLabel === undefined ? {} : { ariaLabel })}
    >
      {children}
    </SampleAction>
  );
}
