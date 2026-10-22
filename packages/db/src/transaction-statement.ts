/** Skip a nested PostgreSQL block comment without interpreting its contents. */
const blockEnd = (text: string) => {
  let depth = 1;
  let at = 2;
  while (depth > 0 && at < text.length) {
    const pair = text.slice(at, at + 2);
    if (pair === '/*') {
      depth += 1;
      at += 2;
    } else if (pair === '*/') {
      depth -= 1;
      at += 2;
    } else at += 1;
  }
  return depth === 0 ? at : text.length;
};

/** Controls and session configuration belong only to the bounded adapter. */
export function assertTransactionStatement(
  text: string,
  refuse: (message: string) => never,
) {
  let rest = text.trimStart();
  while (rest.startsWith('--') || rest.startsWith('/*')) {
    if (rest.startsWith('--')) {
      const end = rest.indexOf('\n');
      rest = end < 0 ? '' : rest.slice(end + 1).trimStart();
    } else rest = rest.slice(blockEnd(rest)).trimStart();
  }
  // Every query uses native prepared protocol, which rejects multi-statements
  // before execution. These first forms cannot commit or change transaction state.
  if (
    !/^(select|with|insert|update|delete|values|show|explain)\b/i.test(rest) ||
    /\bset_config\s*\(/i.test(rest)
  )
    refuse('Transaction controls and configuration are adapter-owned');
}
