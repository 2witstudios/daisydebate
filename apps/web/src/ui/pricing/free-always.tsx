import { FeatureList } from './feature-list';

/** What every account gets without paying: the answer to "what is free". */
export function FreeAlways({ items }: { readonly items: readonly string[] }) {
  return (
    <section
      aria-labelledby="free-always"
      className="flex flex-wrap items-center gap-6 rounded-xl bg-stage-accent p-6 text-stage-accent-ink"
    >
      <div className="flex flex-1 basis-pricing-free-intro flex-col gap-2">
        <h2
          id="free-always"
          className="font-display text-2xl leading-tight font-bold"
        >
          Free, always
        </h2>
        <p>Debating people never costs anything. Every account gets this.</p>
      </div>
      <FeatureList
        items={items}
        layout="band"
        checkClassName="text-stage-accent-ink"
      />
    </section>
  );
}
