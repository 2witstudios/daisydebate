import Link from 'next/link';
import type { SchoolEntries as Read } from '../../../features/tab/entries';
import { Button } from '../../components/button/button';
import { errorClass } from '../../components/form-field/form-field-class';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ActionLink } from '../action-control/action-control';
import { ListCard, ListRow } from '../list-card/list-card';
import { SampleForm, type SampleSubmit } from '../sample-form/sample-form';

/** A responsible adult's own entries at one tournament, and the judges they owe. */
export function SchoolEntries({
  entries,
  submit,
}: {
  readonly entries: Read;
  readonly submit: SampleSubmit;
}) {
  return (
    <ReadingPage>
      <Link
        href={entries.tournament.href}
        className="self-start font-strong text-ink underline"
      >
        {entries.tournament.name}
      </Link>
      <PageHeader title={entries.title} lede={entries.lede} />
      <ListCard>
        <ul>
          {entries.students.map((student) => (
            <ListRow
              key={student.name}
              title={student.name}
              facts={student.note}
              detail={
                <>
                  {student.events}
                  {student.problem === null ? null : (
                    <p
                      role="alert"
                      className={`mt-2 rounded-lg bg-live-soft px-3 py-2 ${errorClass}`}
                    >
                      {student.problem}
                    </p>
                  )}
                </>
              }
              trailing={
                <ActionLink action={student.edit} about={student.name} />
              }
            />
          ))}
          <li className="px-4 py-3">
            <ActionLink action={entries.add} />
          </li>
        </ul>
      </ListCard>
      <ListCard>
        <ul>
          <ListRow
            title={entries.judges.title}
            detail={entries.judges.detail}
            trailing={
              <ActionLink action={entries.judges.add} about="a judge" />
            }
          />
        </ul>
      </ListCard>
      <SampleForm
        action={submit(entries.submit.label)}
        label={entries.submit.label}
        className="flex flex-col gap-2"
      >
        <Button type="submit" disabled={entries.submit.blocked}>
          {entries.submit.label}
        </Button>
        <p className="text-center text-sm text-ink-muted">
          {entries.submit.note}
        </p>
      </SampleForm>
    </ReadingPage>
  );
}
