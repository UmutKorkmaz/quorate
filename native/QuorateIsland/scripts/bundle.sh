#!/bin/sh
# bundle.sh — build QuorateIsland and assemble a (locally) ad-hoc-signed .app.
#
# Produces dist/QuorateIsland.app with:
#   - LSUIElement=true (no Dock icon; menu-bar/notch only)
#   - bundle id app.quorate.island, version 1.4.0
#   - NSHighResolutionCapable
#   - ad-hoc codesign (--force --deep -s -)
#
# Ad-hoc signing is fine for personal/local use. Distribution needs Apple
# Developer ID + notarization (out of scope for the local build path).
set -euo pipefail

cd "$(dirname "$0")/.."  # -> native/QuorateIsland/

VERSION="1.4.0"
BUNDLE_ID="app.quorate.island"
DIST="dist"
APP="$DIST/QuorateIsland.app"

echo "==> swift build -c release --arch arm64"
swift build -c release --arch arm64

BINARY_PATH="$(swift build -c release --arch arm64 --show-bin-path)/QuorateIsland"

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
mkdir -p "$APP/Contents/Resources"

cp "$BINARY_PATH" "$APP/Contents/MacOS/QuorateIsland"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>QuorateIsland</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>Quorate Island</string>
  <key>CFBundleDisplayName</key>
  <string>Quorate Island</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>$VERSION</string>
  <key>CFBundleVersion</key>
  <string>$VERSION</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key>
    <true/>
  </dict>
</dict>
</plist>
PLIST

printf 'APPL????' > "$APP/Contents/PkgInfo"

echo "==> codesign --force --deep -s - (ad-hoc)"
codesign --force --deep -s - "$APP"

echo "==> built: $APP"
echo "    First run: right-click → Open (Gatekeeper prompt for ad-hoc signing)."
