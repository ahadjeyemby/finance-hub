#!/usr/bin/env bash
# Build a signed App Store .ipa on this Mac (no cloud build) and optionally upload it.
#
#   APPLE_TEAM_ID=ABCDE12345 scripts/ios-release.sh           # archive + export .ipa
#   APPLE_TEAM_ID=ABCDE12345 scripts/ios-release.sh --upload  # ...and send it to App Store Connect
#
# Needs: Xcode signed in to the paid Apple Developer account (Xcode > Settings > Accounts),
# CocoaPods, and an app record in App Store Connect with the same bundle identifier as app.json.
# The upload step also needs an app-specific password (appleid.apple.com > Sign-In and Security),
# passed as APPLE_ID and APPLE_APP_PASSWORD. Without --upload, drag the .ipa into Transporter instead.
set -euo pipefail

: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID to your 10-character Apple Developer Team ID}"
export LANG=en_US.UTF-8

cd "$(dirname "$0")/.."
OUT="build/ios"

# Everything below is generated, so rebuild the native project from app.json each time.
bunx expo prebuild --platform ios --clean
WORKSPACE="$(ls -d ios/*.xcworkspace | head -1)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"

rm -rf "$OUT" && mkdir -p "$OUT"

xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$OUT/$SCHEME.xcarchive" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  CODE_SIGN_STYLE=Automatic \
  -allowProvisioningUpdates

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$APPLE_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$OUT/$SCHEME.xcarchive" \
  -exportPath "$OUT" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -allowProvisioningUpdates

IPA="$(ls "$OUT"/*.ipa | head -1)"
echo "Built $IPA"

if [[ "${1:-}" == "--upload" ]]; then
  : "${APPLE_ID:?Set APPLE_ID to your Apple ID email}"
  : "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD to an app-specific password}"
  xcrun altool --upload-app --type ios --file "$IPA" --username "$APPLE_ID" --password "$APPLE_APP_PASSWORD"
fi
