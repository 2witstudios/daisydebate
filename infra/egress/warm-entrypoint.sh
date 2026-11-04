#!/usr/bin/env bash
# Chrome's first launch on a booted machine takes about 15 s and its next under 1 s
# (measured on staging, ISSUE-1303), and a Round's first capture would pay for it in lost
# speech. So one launch happens here, before the service starts and can take a Round.
# Bounded, and its failure only leaves the machine cold: Egress starts regardless.
profile="$(mktemp -d)"
timeout 60 google-chrome --headless=new --no-sandbox --disable-gpu \
  --user-data-dir="$profile" --dump-dom about:blank >/dev/null 2>&1 \
  || echo "egress warm launch did not finish; the first capture will start cold" >&2
rm -rf "$profile"
exec /entrypoint.sh
