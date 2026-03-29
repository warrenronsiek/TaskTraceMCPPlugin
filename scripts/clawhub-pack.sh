#!/usr/bin/env bash
# Creates a flat zip for release/upload of the bundle-only plugin layout.
# The archive root should contain the bundle manifests and shared MCP config,
# not the old native OpenClaw runtime files.
set -euo pipefail

VERSION="${1:?Usage: clawhub-pack.sh <version>}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$REPO_ROOT/dist"
ZIPFILE="$DIST_DIR/tasktrace-mcp-plugin-${VERSION}.zip"

mkdir -p "$DIST_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/.codex-plugin" "$TMP/.claude-plugin" "$TMP/.cursor-plugin" "$TMP/assets"

cp "$REPO_ROOT/package.json"                "$TMP/"
cp "$REPO_ROOT/README.md"                   "$TMP/"
cp "$REPO_ROOT/.mcp.json"                   "$TMP/"
cp "$REPO_ROOT/.codex-plugin/plugin.json"   "$TMP/.codex-plugin/"
cp "$REPO_ROOT/.claude-plugin/plugin.json"  "$TMP/.claude-plugin/"
cp "$REPO_ROOT/.cursor-plugin/plugin.json"  "$TMP/.cursor-plugin/"
cp "$REPO_ROOT/assets/favicon-192x192.png"  "$TMP/assets/"
cp "$REPO_ROOT/assets/tasktrace-logo-black-bg.svg" "$TMP/assets/"

cd "$TMP"
zip -r "$ZIPFILE" .
echo "Created $ZIPFILE"
