import Link from 'next/link';
import type { HelpTopic } from '../../../features/help/topics';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import {
  ArticleList,
  type ArticleListItem,
} from '../../guides/article-list/article-list';
import { OpenTopicFromHash } from './open-topic-from-hash';

/**
 * Help's front door: the reading homes with something to read, then the
 * common questions. Native disclosure, so it works before hydration; a link
 * to /help#topic opens its answer.
 */
export function HelpPage({
  homes,
  topics,
}: {
  readonly homes: readonly ArticleListItem[];
  readonly topics: readonly HelpTopic[];
}) {
  return (
    <ReadingPage>
      <PageHeader
        title="Help"
        lede="Guides to using Daisy, lessons in debate, and answers to common questions."
      />
      {homes.length > 0 ? (
        <ArticleList label="Guides and learning" items={homes} />
      ) : null}
      <h2 className="font-display text-xl font-bold">Common questions</h2>
      <ul className="flex flex-col gap-3">
        {topics.map((topic) => (
          <li key={topic.id} className="rounded-xl bg-surface p-5 shadow-1">
            <details>
              <summary
                id={topic.id}
                className="cursor-pointer text-base font-bold text-ink"
              >
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
      <p className="text-base text-ink-muted">
        No answer here? <Link href="/support">Contact support</Link>.
      </p>
      <OpenTopicFromHash topicIds={topics.map((topic) => topic.id)} />
    </ReadingPage>
  );
}
