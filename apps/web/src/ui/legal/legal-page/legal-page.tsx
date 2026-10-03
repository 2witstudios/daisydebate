import type { LegalDocument } from '../../../features/legal/documents';
import { PageHeader } from '../../components/page-header/page-header';

/**
 * A legal document: a title and version, a contents list, and each section
 * under its own anchor so a link can name the part it means.
 */
export function LegalPage({ document }: { readonly document: LegalDocument }) {
  return (
    <div className="flex max-w-reading flex-col gap-8">
      <PageHeader
        title={document.title}
        lede={`${document.lede} Version ${document.version}.`}
      />
      <nav
        aria-label="Contents"
        className="flex flex-col gap-2 rounded-xl bg-surface p-5 shadow-1"
      >
        <p className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          On this page
        </p>
        <ol className="flex flex-col gap-1 text-base">
          {document.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.heading}</a>
            </li>
          ))}
        </ol>
      </nav>
      {document.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-heading`}
          className="flex flex-col gap-3"
        >
          <h2
            id={`${section.id}-heading`}
            className="font-display text-xl font-bold text-ink"
          >
            {section.heading}
          </h2>
          {section.paragraphs.map((paragraph) => (
            <p
              key={paragraph}
              className="text-base leading-normal text-ink-muted"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
