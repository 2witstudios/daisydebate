#!/bin/sh
# Manual follow-ups to the tx sweep (one-time): bounded writers named `transaction` become `run`.
set -e
cd "$(git rev-parse --show-toplevel)/packages/db"
python3 - <<'PY'
import re
def edit(p, pairs):
    s=open(p).read()
    for a,b in pairs:
        assert a in s, (p,a)
        s=s.replace(a,b)
    open(p,'w').write(s)
edit('src/authorization.ts',[("  T,\n  Tx extends Tx,\n>(","  T,\n>(")])
s=open('src/agreement-signatures.ts').read()
s=s.replace("type Transaction = <T>(run: (tx: Tx) => Promise<T>) => Promise<T>;\n\n","")
s=s.replace("  const transaction = database.transaction.bind(database) as Transaction;\n","")
s=re.sub(r"(?<![\w.])transaction\(\(tx\)", "inTransaction(database, (tx)", s)
s=re.sub(r"(?<![\w.])transaction\(async \(tx\)", "inTransaction(database, async (tx)", s)
s=s.replace("transactionNow(tx as never)","transactionNow(tx)")
s=re.sub(r"import type \{ ([^}]*) \} from './tx';", lambda m: "import { inTransaction, " + ", ".join("type "+x.strip() for x in m.group(1).split(",")) + " } from './tx';", s)
open('src/agreement-signatures.ts','w').write(s)
edit('src/test-only-operations.ts',[("    transaction: database.transaction.bind(database),","    transaction: <T>(work: (tx: Tx) => Promise<T>) =>\n      inTransaction(database, work),"),("import { users } from './schema/users';","import { users } from './schema/users';\nimport { inTransaction, type Tx } from './tx';")])
edit('src/media-capture.ts',[("dependencies.transaction(","dependencies.run(")])
edit('src/media-capture-context.ts',[("  readonly transaction: BoundedTransaction;","  readonly run: BoundedTransaction;")])
edit('src/attendance-operations.ts',[("deps.transaction(","deps.run("),("  readonly transaction: AttendanceTransaction;","  readonly run: AttendanceTransaction;")])
PY
for f in integration/attendance-targets.integration.ts:36 integration/fenced-admission.integration.ts:70 src/index.ts:533; do file=${f%%:*}; line=${f##*:}; sed -i '' "${line}s/transaction: /run: /" $file; done
for f in integration/media-capture.test-support.ts:51 integration/media-worker-lease.integration.ts:24 integration/necessary-evidence.test-support.ts:23 src/attendance-entrypoints.ts:43; do file=${f%%:*}; line=${f##*:}; sed -i '' "${line}s/transaction,/run: transaction,/" $file; done
sed -i '' "528s/'transaction'>/'run'>/" src/index.ts
