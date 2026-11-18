import { Icon } from '../components/icon/icon';

export type PricingQuestion = {
  readonly question: string;
  readonly answer: string;
};

/**
 * The pricing questions as native disclosures, so each opens without
 * script. The first starts open.
 */
export function PricingFaq({
  questions,
}: {
  readonly questions: readonly PricingQuestion[];
}) {
  return (
    <section
      aria-labelledby="pricing-faq"
      data-pricing-faq
      className="flex flex-col gap-2"
    >
      <h2
        id="pricing-faq"
        className="mb-2 font-display text-2xl leading-tight font-bold"
      >
        Questions
      </h2>
      {questions.map(({ question, answer }, index) => (
        <details
          key={question}
          open={index === 0}
          className="group border-t border-border"
        >
          <summary className="flex min-h-pricing-question cursor-pointer list-none items-center justify-between gap-3 py-1 text-md font-semibold">
            {question}
            <Icon
              name="chevronRight"
              size={18}
              className="text-ink-muted transition-transform group-open:rotate-90 motion-reduce:transition-none"
            />
          </summary>
          <p className="mb-4 max-w-reading text-ink-muted">{answer}</p>
        </details>
      ))}
    </section>
  );
}
