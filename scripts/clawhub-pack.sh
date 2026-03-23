#!/usr/bin/env bash
# Creates a flat zip for ClawHub upload.
# ClawHub expects package.json and openclaw.plugin.json at the archive root,
# not nested inside a wrapper directory (as GitHub release tarballs and npm pack produce).
set -euo pipefail

VERSION="${1:?Usage: clawhub-pack.sh <version>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
ZIPFILE="$DIST_DIR/tasktrace-mcp-plugin-${VERSION}.zip"

mkdir -p "$DIST_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$REPO_ROOT/package.json"         "$TMP/"
cp "$REPO_ROOT/index.js"             "$TMP/"
cp "$REPO_ROOT/openclaw.plugin.json" "$TMP/"
cp "$REPO_ROOT/README.md"            "$TMP/"

cd "$TMP"
zip -r "$ZIPFILE" .
echo "Created $ZIPFILE"
