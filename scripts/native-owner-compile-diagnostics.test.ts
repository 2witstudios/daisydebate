import { assert, setupRitewayBun, test } from 'riteway/bun';
setupRitewayBun();
const classify = (text: string) => {
  const source = `import json,sys
sys.path.insert(0,'packages/media/integration/native-owner-compile')
from diagnostics import classify_failure
print(json.dumps(classify_failure(json.load(sys.stdin),'/unused')))`;
  const child = Bun.spawnSync(['python3', '-B', '-c', source], {
    stdin: new TextEncoder().encode(JSON.stringify(text)),
  });
  if (child.exitCode !== 0) throw new Error('Diagnostic control failed');
  return JSON.parse(child.stdout.toString()) as Record<string, unknown>;
};

test('Cargo build-script filesystem refusal survives an empty Rust-code whitelist', () => {
  const result = classify(
    'error: failed to run custom build command for `webrtc-sys v0.3.50`\nCaused by:\n thread main panicked at /unused/source/webrtc-sys/build.rs:113:50\n Read-only file system (os error 30)',
  );
  assert({
    given: 'a real-shaped build-script failure without an E-code',
    should: 'retain the actionable filesystem refusal and build-script context',
    actual: {
      category: result.category,
      retained:
        String(result.excerpt).includes('os error 30') &&
        String(result.excerpt).includes('<source>/webrtc-sys/build.rs'),
    },
    expected: { category: 'filesystem-permission', retained: true },
  });
});

test('unknown compiler failure retains bounded evidence while private values disappear', () => {
  const result = classify(
    'x'.repeat(70000) +
      '\nerror: vendor diagnostic with no recognized category\n Authorization: Bearer synthetic-private-value\n password=hidden-pass\n https://user:private-pass@example.invalid/path?token=private-query\n /Users/alice/private/file.rs\n actor@example.invalid\n ::set-output name=leak::private-output\n',
  );
  const text = JSON.stringify(result);
  assert({
    given:
      'an unknown failure mixed with credentials, private paths, email and runner directives',
    should: 'remain unknown and expose bounded sanitized evidence only',
    actual: {
      category: result.category,
      bounded: Number(result.excerptBytes) <= 8192,
      privateBytes: [
        'synthetic-private-value',
        'hidden-pass',
        'private-pass',
        'private-query',
        '/Users/alice',
        'actor@example.invalid',
        '::set-output',
      ].some((value) => text.includes(value)),
      retained: String(result.excerpt).includes('vendor diagnostic'),
    },
    expected: {
      category: 'unknown',
      bounded: true,
      privateBytes: false,
      retained: true,
    },
  });
});

test('missing protobuf compiler and download status are classified without inventing a resource cause', () => {
  const prerequisite = classify(
    'error: failed to run custom build command for `livekit-ffi v0.13.1`\nCould not find `protoc`. Protobuf generation failed',
  );
  const network = classify(
    'error: failed to download webrtc: HTTP 403 Forbidden https://user:secret@example.invalid/file?token=hidden',
  );
  assert({
    given: 'specific missing-protoc and HTTP failure narratives',
    should: 'identify those evidence classes independently of resource limits',
    actual: [prerequisite.category, network.category],
    expected: ['missing-prerequisite', 'network'],
  });
});

test('Rust and linker diagnostics retain their distinct evidence', () => {
  const rust = classify('error[E0433]: failed to resolve a declared module');
  const linker = classify(
    'error: linking with cc failed: exit status 1\nundefined reference to a_native_symbol',
  );
  assert({
    given: 'compiler E-code and linker failure diagnostics',
    should: 'retain each supported classification',
    actual: {
      rust: rust.category,
      codes: rust.rustErrorCodes,
      linker: linker.category,
    },
    expected: { rust: 'rust-compiler', codes: ['E0433'], linker: 'linker' },
  });
});
