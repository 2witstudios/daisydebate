#!/bin/sh
set -eu
stage() { printf 'daisy-browser-stage:%s\n' "$1"; }
stage os-trust
cp /fixture/ca.crt /usr/local/share/ca-certificates/daisy-isolated-proof.crt
update-ca-certificates >/dev/null
stage nss-trust
install -d -o pwuser -g pwuser /home/pwuser/.local/share/pki/nssdb
runuser -u pwuser -- certutil -N -d sql:/home/pwuser/.local/share/pki/nssdb --empty-password
runuser -u pwuser -- certutil -A -d sql:/home/pwuser/.local/share/pki/nssdb -n DaisyIsolatedProof -t C,, -i /fixture/ca.crt
stage sandboxed-browser
exec runuser -u pwuser -- node /workspace/apps/web/e2e/support/launch-browser-network.mjs
