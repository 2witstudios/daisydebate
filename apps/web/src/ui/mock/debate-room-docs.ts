import type {
  DebateMark,
  DocJSON,
  FolderId,
  TemplateId,
  WorkspaceDocument,
} from '../../features/debate-room/documents';

/** Inline text: plain, bold (`**x**`) or a debate mark (`{dropped:x}`). */
const inline = (source: string): DocJSON[] =>
  source
    .split(/(\*\*.+?\*\*|\{\w+:.+?\})/)
    .filter((part) => part !== '')
    .map((part) => {
      const bold = /^\*\*(.+)\*\*$/.exec(part);
      if (bold)
        return { type: 'text', text: bold[1]!, marks: [{ type: 'bold' }] };
      const mark = /^\{(\w+):(.+)\}$/.exec(part);
      if (mark)
        return {
          type: 'text',
          text: mark[2]!,
          marks: [
            { type: 'debateMark', attrs: { kind: mark[1] as DebateMark } },
          ],
        };
      return { type: 'text', text: part };
    });

const heading = (level: 1 | 2, text: string): DocJSON => ({
  type: 'heading',
  attrs: { level },
  content: inline(text),
});

const bullets = (...items: string[]): DocJSON => ({
  type: 'bulletList',
  content: items.map((item) => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: inline(item) }],
  })),
});

const tasks = (...items: (readonly [boolean, string])[]): DocJSON => ({
  type: 'taskList',
  content: items.map(([checked, item]) => ({
    type: 'taskItem',
    attrs: { checked },
    content: [{ type: 'paragraph', content: inline(item) }],
  })),
});

const doc = (...content: DocJSON[]): DocJSON => ({ type: 'doc', content });

const at = '2026-10-05T18:00:00.000Z';

const sample = (
  id: string,
  title: string,
  folder: FolderId,
  templateId: TemplateId,
  content: DocJSON,
): WorkspaceDocument => ({
  id,
  title,
  folder,
  templateId,
  content,
  createdAt: at,
  updatedAt: at,
});

/** The debater's files for the sample round, their library and their club's. */
export const sampleRoomDocuments: readonly WorkspaceDocument[] = [
  sample(
    'doc-flow',
    'Flow',
    'round',
    'flow',
    doc(
      heading(1, 'Flow'),
      heading(2, 'AC · Aff'),
      bullets(
        '**FW** ocean harm outweighs: irreversible, global',
        '**C1** 8M t/yr into oceans {neg:2015 source}',
        '**C2** microplastics in drinking water',
        '**C3** bans work: Kenya 2017',
      ),
      heading(2, 'NC · You'),
      bullets(
        '**FW** weigh net emissions',
        '**C2** {neg:Turn} substitutes shed fibers too',
        '**N2** substitutes: higher lifecycle emissions',
        '**N3** no medical exemption',
      ),
      heading(2, '1AR · Aff'),
      bullets(
        '**FW** plastic is permanent, emissions aren’t',
        '**C3** {dropped:no answer}',
        '**N2** {dropped:no answer}',
        '**N3** plan exempts hospitals {new:New}',
      ),
    ),
  ),
  sample(
    'doc-cx',
    'CX',
    'round',
    'cross-ex',
    doc(
      heading(1, 'CX'),
      heading(2, 'Questions'),
      tasks(
        [true, 'Year of the 8M figure? **2015**'],
        [true, 'Kenya: compliance or enforcement? **compliance surveys**'],
        [false, 'What replaces sterile packaging?'],
        [false, 'Who pays for the transition?'],
      ),
      heading(2, 'Admissions'),
      bullets('Kenya data is self-reported {extend:use in NR}'),
    ),
  ),
  sample(
    'doc-nr',
    'NR plan',
    'round',
    'speech-plan',
    doc(
      heading(1, 'NR · 5:00'),
      bullets(
        '**0:30** overview: two drops decide it',
        '**1:30** N2 substitutes {extend:Extend} outweighs C1',
        '**1:15** C3 {dropped:dropped} so the ban has no solvency',
        '**0:45** FW: lifecycle beats permanence',
        '**0:30** N3 hospital exemption {new:New in 1AR}',
        '**0:30** voters',
      ),
    ),
  ),
  sample(
    'doc-case',
    'Neg case: plastics',
    'library',
    'case',
    doc(
      heading(1, 'Neg case: plastics'),
      bullets(
        '**N1** cost to low-income households',
        '**N2** substitutes: higher lifecycle emissions',
        '**N3** medical and food-safety uses',
      ),
    ),
  ),
  sample(
    'doc-bans',
    'Blocks: bans',
    'library',
    'block',
    doc(
      heading(1, 'Blocks: bans'),
      heading(2, 'Kenya 2017'),
      bullets(
        'compliance ≠ enforcement',
        'bags smuggled from neighbouring states',
      ),
    ),
  ),
  sample(
    'doc-club',
    'Club prep: plastics',
    'club',
    'case',
    doc(
      heading(1, 'Club prep: plastics'),
      heading(2, 'Neg strategy'),
      bullets(
        'run substitutes early, extend it if dropped',
        'press medical exemptions in CX',
      ),
    ),
  ),
];
