#!/bin/bash
# Send test push notification to booted iOS simulator
DEVICE_UUID=$(xcrun simctl list devices | grep Booted | head -1 | sed -E 's/.* \(([-0-9A-Z]+)\) .*/\1/')
BUNDLE_ID="az.linkfit.app"

if [ -z "$DEVICE_UUID" ]; then
  echo "❌ No booted simulator found. Please boot your iPhone simulator first."
  exit 1
fi

APNS_FILE=$1
if [ -z "$APNS_FILE" ]; then
  echo "ℹ️ Usage: ./send_test_push.sh <payload.apns>"
  echo "Available payloads:"
  ls -1 *.apns
  exit 1
fi

echo "🚀 Sending push notification ($APNS_FILE) to simulator ($DEVICE_UUID)..."
xcrun simctl push "$DEVICE_UUID" "$BUNDLE_ID" "$APNS_FILE"
echo "✅ Done! Check your simulator screen."
