'use client';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section>
      <h1>Something went wrong</h1>
      <p>
        This failure was recorded with correlation identifier{' '}
        {error.digest ?? 'unknown'}.
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
