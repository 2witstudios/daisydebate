import Link from 'next/link';
import type { HelpTopic } from '../../../features/help/topics';
import { PageHeader } from '../../components/page-header/page-header';

/** Common questions. Native disclosure, so it works without JavaScript. */
export function HelpPage({
  topics,
}: {
  readonly topics: readonly HelpTopic[];
}) {
  return (
    <div className="flex max-w-reading flex-col gap-6">
      <PageHeader
        title="Help"
        lede="Answers to the questions people ask most."
      />
      <ul className="flex flex-col gap-3">
        {topics.map((topic) => (
          <li
            key={topic.id}
            id={topic.id}
            className="rounded-xl bg-surface p-5 shadow-1"
          >
            <details>
              <summary className="cursor-pointer text-base font-bold text-ink">
                {topic.question}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <p className="text-base leading-normal text-ink-muted">
                  {topic.answer}
                </p>
                <ul className="flex flex-wrap gap-4 text-sm">
                  {topic.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href}>{link.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
