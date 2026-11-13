#!/usr/bin/env bash
# Builds a signed release APK into release/KnightScope-<version>.apk
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -f android/keystore.properties ] && [ -z "${KS_STORE_FILE:-}" ]; then
  echo "No signing key: create android/keystore.properties or set KS_* variables (see README)." >&2
  exit 1
fi
VERSION=$(sed -n 's/.*versionName "\(.*\)"/\1/p' android/app/build.gradle)
npm run build
npx cap sync android
(cd android && ./gradlew --quiet assembleRelease)
mkdir -p release
OUT="release/KnightScope-${VERSION}.apk"
cp android/app/build/outputs/apk/release/app-release.apk "$OUT"
APKSIGNER=$(ls -d "${ANDROID_HOME:-$HOME/Android/Sdk}"/build-tools/*/apksigner | sort -V | tail -1)
"$APKSIGNER" verify --print-certs "$OUT" | head -3
sha256sum "$OUT" | tee "$OUT.sha256"
echo "Release APK: $OUT"
