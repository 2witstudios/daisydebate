import { prose } from './ui/prose-class';
export default function Loading() {
  return (
    <main aria-busy="true" aria-live="polite">
      <p className={prose.p}>Loading…</p>
    </main>
  );
}
