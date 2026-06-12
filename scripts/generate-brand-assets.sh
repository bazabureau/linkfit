#!/usr/bin/env bash
# Resize one 1024×1024 master icon into every size you'll actually need:
# iOS (handled by Xcode, but exported for reference), web favicons, social
# meta images, app store listing, and a transparent-background variant.
#
# Usage:
#   ./scripts/generate-brand-assets.sh path/to/icon-1024.png
#
# Requires: sips (built into macOS), no external dependencies.

set -euo pipefail

SRC="${1:-}"
if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "usage: $0 path/to/icon-1024.png"
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/brand-assets"
mkdir -p "$OUT/ios" "$OUT/web" "$OUT/social" "$OUT/appstore"

echo "Source: $SRC"
echo "Output: $OUT"
echo ""

resize() {
  local size="$1"
  local dest="$2"
  sips -s format png -z "$size" "$size" "$SRC" --out "$dest" >/dev/null
  echo "  ✓ ${size}×${size}  →  ${dest#$ROOT/}"
}

echo "iOS reference sizes (Xcode auto-generates these from icon-1024 — exported for verification):"
resize 1024 "$OUT/ios/icon-1024.png"
resize 180  "$OUT/ios/icon-180.png"      # iPhone @3x
resize 120  "$OUT/ios/icon-120.png"      # iPhone @2x
resize 87   "$OUT/ios/icon-87.png"       # Settings @3x
resize 80   "$OUT/ios/icon-80.png"       # Spotlight @2x
resize 60   "$OUT/ios/icon-60.png"       # Notification @3x
resize 58   "$OUT/ios/icon-58.png"       # Settings @2x
resize 40   "$OUT/ios/icon-40.png"       # Spotlight / Notification @2x

echo ""
echo "Web favicons:"
resize 512 "$OUT/web/favicon-512.png"
resize 256 "$OUT/web/favicon-256.png"
resize 192 "$OUT/web/favicon-192.png"    # Android home screen
resize 180 "$OUT/web/apple-touch-icon.png"
resize 96  "$OUT/web/favicon-96.png"
resize 48  "$OUT/web/favicon-48.png"
resize 32  "$OUT/web/favicon-32.png"
resize 16  "$OUT/web/favicon-16.png"

echo ""
echo "Social / OG meta:"
resize 1200 "$OUT/social/og-square-1200.png"        # OG / Twitter card square
resize 800  "$OUT/social/social-avatar-800.png"     # Twitter/X, GitHub avatar
resize 400  "$OUT/social/social-avatar-400.png"     # Instagram profile
resize 200  "$OUT/social/social-avatar-200.png"     # comments, small avatars

echo ""
echo "App Store / Press kit:"
resize 1024 "$OUT/appstore/appstore-1024.png"       # App Store listing icon
cp "$SRC" "$OUT/appstore/press-master-1024.png"     # untouched master copy

echo ""
echo "Done. All assets written to: $OUT"
echo ""
echo "Next:"
echo "  1. Copy $OUT/ios/icon-1024.png to apps/ios/Linkfit/Resources/Assets.xcassets/AppIcon.appiconset/"
echo "  2. Add favicons from $OUT/web/ to your web app's public/ folder"
echo "  3. Use $OUT/social/ files for OG meta tags and social profile images"
