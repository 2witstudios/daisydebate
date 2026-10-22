#!/bin/sh
set -eu
apt-get update -qq
apt-get install -y -qq --no-install-recommends libnss3-tools >/dev/null
cp /fixture/ca.crt /usr/local/share/ca-certificates/daisy-isolated-proof.crt
update-ca-certificates >/dev/null
install -d -o pwuser -g pwuser /home/pwuser/.local/share/pki/nssdb
runuser -u pwuser -- certutil -N -d sql:/home/pwuser/.local/share/pki/nssdb --empty-password
runuser -u pwuser -- certutil -A -d sql:/home/pwuser/.local/share/pki/nssdb -n DaisyIsolatedProof -t C,, -i /fixture/ca.crt
exec runuser -u pwuser -- node /workspace/apps/web/e2e/support/launch-browser-network.mjs
