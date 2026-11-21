import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql, type SQL as Statement } from 'drizzle-orm';
import { ownLinksDelete } from '../src/provisional-cleanup';
import { abandonedCandidatesRead } from '../src/provisional-retention';
import { scratchDatabase } from '../src/testing-scratch';

type PlanNode = {
  readonly 'Node Type': string;
  readonly 'Relation Name'?: string;
  readonly 'Index Name'?: string;
  readonly 'Index Cond'?: string;
  readonly 'Actual Rows'?: number;
  readonly Plans?: readonly PlanNode[];
};

const planNodes = (node: PlanNode): readonly PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(planNodes),
];

const usesPurposeRange = (nodes: readonly PlanNode[], purpose: string) =>
  // text_pattern_ops bounds the ASCII ':' suffix with its successor ';'.
  nodes.some(
    (node) =>
      node['Index Name'] === 'verification_identifier_pattern_idx' &&
      node['Index Cond']?.includes(`identifier ~>=~ '${purpose}:'::text`) &&
      node['Index Cond'].includes(`identifier ~<~ '${purpose};'::text`),
  );

export async function explainProvisionalRetention(
  url: string,
  options: Parameters<typeof abandonedCandidatesRead>[0] &
    Parameters<typeof ownLinksDelete>[1] & { readonly old: string },
) {
  const { before, old } = options;
  // Earlier suites can leave different statistics and dead tuples even after
  // deleting their rows. Use the real migrations in an isolated database.
  const scratch = scratchDatabase(url, 'retentionplan');
  await scratch.create();
  const client = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate(() => true);
    // Old and fresh provisional sign-ups are sparse among claimed accounts.
    await client`insert into users (id,email,username,created_at,deleted_at)
      select 'proof-user-' || n,
             case when n <= 9950 then 'proof-' || n || '@example.test' end,
             case when n > 200 then 'proof-member-' || n end,
             case when n between 101 and 200 then ${before}::timestamptz
                  else ${old}::timestamptz + n * interval '1 second' end,
             case when n > 9950 then ${before}::timestamptz end
      from generate_series(1, 10000) as rows(n)`;
    // Recent sessions protect ten other old provisionals. Most sessions
    // belong to claimed accounts, so the session anti-join has real inputs.
    await client`insert into session (id,token,user_id,expires_at,created_at,updated_at)
      select 'proof-session-' || n, 'proof-token-' || n, 'proof-user-' || n,
             '2099-01-01', ${old}::timestamptz, ${before}::timestamptz
      from generate_series(21, 5030) as rows(n)
      where n <= 30 or n > 200`;
    // Recent sign-in links protect ten candidates. The next candidate has
    // older links to clean up. Each cleanup purpose is sparse among other links.
    await client`insert into verification (id,identifier,value,expires_at,created_at)
      select 'proof-link-' || n,
             (case when n <= 20 then 'sign-in'
                   when n <= 30 then 'email-change-approve'
                   when n <= 40 then 'email-change-verify'
                   when n <= 3000 then 'email-change-other'
                   else 'other' end) || ':' || n,
             case when n <= 20 then json_build_object('email', 'proof-' || n || '@example.test')::text
                  when n <= 40 then json_build_object('userId', 'proof-user-11')::text
                  else 'not JSON' end,
             '2099-01-01', case when n between 11 and 40 then ${old}::timestamptz
                                else ${before}::timestamptz end
      from generate_series(1, 10000) as rows(n)`;
    await client`analyze users`;
    await client`analyze session`;
    await client`analyze verification`;

    const db = drizzle({ client });
    const explain = async (statement: Statement) => {
      const [row] = (await db.execute(statement)) as unknown as {
        'QUERY PLAN': [{ Plan: PlanNode }];
      }[];
      return row!['QUERY PLAN'][0].Plan;
    };
    const read = await explain(
      sql`explain (analyze, format json) ${abandonedCandidatesRead(options)}`,
    );
    const owner = { id: 'proof-user-11', email: 'proof-11@example.test' };
    const cleanup = await explain(
      sql`explain (format json) ${ownLinksDelete(owner, options)}`,
    );
    const readNodes = planNodes(read);
    const cleanupNodes = planNodes(cleanup);

    return {
      proof: {
        batchSize: read['Actual Rows'],
        candidateRange: readNodes.some(
          (node) =>
            node['Index Name'] === 'users_provisional_created_idx' &&
            node['Index Cond']?.includes('created_at <'),
        ),
        signInRange: usesPurposeRange(readNodes, options.signInPurpose),
        missingCleanupRanges: [
          options.signInPurpose,
          ...options.emailChangePurposes,
        ].filter((purpose) => !usesPurposeRange(cleanupNodes, purpose)),
        fullScan: [...readNodes, ...cleanupNodes]
          .filter((node) => node['Node Type'] === 'Seq Scan')
          .map((node) => node['Relation Name'])
          .filter(
            (relation) => relation === 'users' || relation === 'verification',
          ),
      },
      plans: { read, cleanup },
    };
  } finally {
    await client.close();
    await scratch.drop();
  }
}
