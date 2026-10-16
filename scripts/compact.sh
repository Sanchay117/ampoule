#!/usr/bin/env bash
# Compile Compact sources with toolchain 0.31.1 (language 0.23.0, compact-runtime 0.16.0),
# the version the Midnight compatibility matrix lists for Preview, Preprod and Mainnet.
#
#   scripts/compact.sh [--skip-zk] <src.compact> <outdir>
#
# Uses, in order: $COMPACTC, a `compact` devtools install, or ~/.local/compactc-0.31.1.
set -euo pipefail

VERSION=0.31.1
flags=(); pos=()
for a in "$@"; do
  case "$a" in
    --*) flags+=("$a") ;;
    *) pos+=("$a") ;;
  esac
done
[[ ${#pos[@]} -eq 2 ]] || { echo "usage: scripts/compact.sh [--skip-zk] <src.compact> <outdir>" >&2; exit 2; }

if [[ -n "${COMPACTC:-}" ]]; then
  exec "$COMPACTC" ${flags[@]+"${flags[@]}"} "${pos[0]}" "${pos[1]}"
fi
if command -v compact >/dev/null 2>&1; then
  exec compact compile "+${VERSION}" ${flags[@]+"${flags[@]}"} "${pos[0]}" "${pos[1]}"
fi
if [[ -x "$HOME/.local/compactc-${VERSION}/compactc" ]]; then
  exec "$HOME/.local/compactc-${VERSION}/compactc" ${flags[@]+"${flags[@]}"} "${pos[0]}" "${pos[1]}"
fi
echo "Compact ${VERSION} not found. Install it with:" >&2
echo "  curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh" >&2
echo "  compact update ${VERSION}" >&2
exit 1
