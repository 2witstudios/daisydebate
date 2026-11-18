'use client';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
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
  const pathname = usePathname();
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
