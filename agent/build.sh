#!/bin/sh
set -eu
cd /src/agent
mkdir -p /out/v1.0.0
for arch in amd64 arm64; do
  CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -trimpath -buildvcs=false -ldflags='-s -w -buildid=' -o "/out/v1.0.0/pulsy-agent-linux-$arch" .
done
cp install.sh compose.yaml /out/v1.0.0/
cd /out/v1.0.0
sha256sum pulsy-agent-linux-amd64 pulsy-agent-linux-arm64 install.sh compose.yaml > SHA256SUMS
