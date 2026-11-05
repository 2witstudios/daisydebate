import Link from 'next/link';
import { PageHeader } from '../components/page-header/page-header';
import { Panel } from '../components/panel/panel';
import { ReadingPage } from '../components/reading-page/reading-page';

/** Premium pays for AI and capture while human play and official results stay open. */
export function PremiumPage() {
  return (
    <ReadingPage>
      <PageHeader
        title="Daisy Premium"
        lede="More ways to practise, review and share your debates."
      />
      <Panel title="Premium · USD 10/month">
        <ul className="flex list-disc flex-col gap-3 pl-5">
          <li>Five bot debates per billing period.</li>
          <li>Unlimited casual AI judging.</li>
          <li>Round analysis when you request it.</li>
          <li>Host casual recording and broadcast.</li>
          <li>Download Recordings you are authorized to watch.</li>
        </ul>
      </Panel>
      <Panel title="Human debate stays free">
        <div className="flex flex-col gap-3">
          <p>
            Play against other people for free. Ranked AI judging and access to
            existing ballots stay free under their normal permissions.
          </p>
          <p>
            Each free account gets one bot debate, its optional associated AI
            judge, and one requested Round analysis, ever. These free allowances
            do not reset each month.
          </p>
          <Link href="/play" className="underline">
            Play a debate
          </Link>
        </div>
      </Panel>
      <Panel title="Your debates stay yours">
        <div className="flex flex-col gap-3">
          <p>
            Premium renews monthly. Cancelling renewal normally keeps paid
            access through the end of the paid billing period.
          </p>
          <p>
            Your delivered analysis stays readable to you after Premium ends,
            while its content is retained. Existing Recordings remain watchable
            under their visibility rules. Premium does not change who can access
            private content.
          </p>
        </div>
      </Panel>
    </ReadingPage>
  );
}
