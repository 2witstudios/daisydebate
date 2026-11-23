import Link from 'next/link';
import type { Block, Prose } from '../../../features/guides/article';
import { proseRuns } from '../../../features/guides/prose';

/** Article copy with its links. */
function ProseText({ text }: { readonly text: Prose }) {
  return (
    <>
      {proseRuns(text).map((run, index) =>
        run.kind === 'link' ? (
          <Link
            key={index}
            href={run.href}
            className="underline underline-offset-2"
          >
            {run.text}
          </Link>
        ) : (
          run.text
        ),
      )}
    </>
  );
}

const body = 'text-base leading-normal text-ink';

function ArticleBlock({ block }: { readonly block: Block }) {
  switch (block.kind) {
    case 'paragraph':
      return (
        <p className={body}>
          <ProseText text={block.text} />
        </p>
      );
    case 'heading':
      return (
        <h2
          id={block.id}
          className="pt-2 font-display text-xl leading-tight font-bold"
        >
          {block.text}
        </h2>
      );
    case 'steps':
      return (
        <ol className={`${body} flex list-decimal flex-col gap-2 ps-6`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <ProseText text={item} />
            </li>
          ))}
        </ol>
      );
    case 'list':
      return (
        <ul className={`${body} flex list-disc flex-col gap-2 ps-6`}>
          {block.items.map((item, index) => (
            <li key={index}>
              <ProseText text={item} />
            </li>
          ))}
        </ul>
      );
    case 'terms':
      return (
        <dl className="flex flex-col gap-4">
          {block.items.map((item) => (
            <div key={item.term} className="flex flex-col gap-1">
              <dt className="font-strong text-ink">{item.term}</dt>
              <dd className={body}>
                <ProseText text={item.detail} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case 'note':
      return (
        <p className={`${body} rounded-xl bg-surface p-5 shadow-1`}>
          <ProseText text={block.text} />
        </p>
      );
    case 'example':
      return (
        <figure className="flex flex-col gap-2 rounded-xl border border-border p-5">
          <figcaption className="text-sm font-strong text-ink-muted">
            {block.label}
          </figcaption>
          <blockquote className={body}>{block.text}</blockquote>
        </figure>
      );
  }
}

/** An article's body, in reading order. */
export function ArticleBlocks({
  blocks,
}: {
  readonly blocks: readonly Block[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {blocks.map((block, index) => (
        <ArticleBlock key={index} block={block} />
      ))}
    </div>
  );
}
