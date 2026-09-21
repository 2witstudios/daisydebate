import type { Metadata } from 'next';
import { prose } from '../ui/prose-class';

export const metadata: Metadata = { title: 'Foundation proof' };
// Reachable only when the deployment enables the proof: the proxy refuses
// /foundation with a real 404 unless FOUNDATION_PROOF_ENABLED=true. The API
// behind this page re-checks the flag at request time in feature operations.
export default function FoundationProofPage() {
  return (
    <section>
      <h1 className={prose.h1}>Foundation proof</h1>
      <p className={prose.p}>
        Development-only architectural proof of the vertical path: transport →
        validated application operation → domain runtime → durable adapter →
        PostgreSQL.
      </p>
      <h2 className={prose.h2}>Endpoints</h2>
      <p className={prose.p}>
        <code className={prose.code}>POST /api/foundation/proof</code> with{' '}
        <code className={prose.code}>{'{"resolution": "…"}'}</code>, JSON
        content type, and a same-origin{' '}
        <code className={prose.code}>Origin</code> header creates a debate and
        stores its protocol snapshot.
      </p>
      <p className={prose.p}>
        <code className={prose.code}>GET /api/foundation/proof?id=…</code> loads
        the record, restores the domain runtime from the snapshot, and returns
        the re-validated representation.
      </p>
    </section>
  );
}
