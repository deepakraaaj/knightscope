#!/usr/bin/env bash
# Builds Stockfish 19 "Lite" (same source + NNUE net as the stockfish@19.0.1 npm WASM build used
# by the web app) as native Android executables and installs them as
#   android/app/src/main/jniLibs/<abi>/libstockfish.so
# The Android plugin (KnightScopeEnginePlugin) launches that file from nativeLibraryDir.
#
# Usage: native/build-android-engine.sh [--host] [--abi arm64-v8a|x86_64]...
#   --host   additionally build a plain Linux x86-64 binary (native/stockfish/out/host/stockfish)
#            from the same source/net, for verifying UCI behaviour on the build machine.
# Env:     NDK (default ~/Android/Sdk/ndk/27.1.12297006), JOBS (default 2), API (default 24 = minSdk)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SF_DIR="$ROOT/native/stockfish/stockfish.js"
SF_REPO="https://github.com/nmrugg/stockfish.js.git"
# stockfish.js commit whose package.json is 19.0.1 (matches the npm package used by the web app).
SF_COMMIT="0dc3d0ac03705353dad6659c0dad4597cdee4021"
NDK="${NDK:-$HOME/Android/Sdk/ndk/27.1.12297006}"
JOBS="${JOBS:-2}"
API="${API:-24}"
JNILIBS="$ROOT/android/app/src/main/jniLibs"
OUT="$ROOT/native/stockfish/out"
ENGINE_VERSION="19 Lite"

BUILD_HOST=no
ABIS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --host) BUILD_HOST=yes ;;
    --abi) shift; ABIS+=("$1") ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
  shift
done
[ ${#ABIS[@]} -eq 0 ] && ABIS=(arm64-v8a x86_64)

TOOLCHAIN="$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin"
[ -x "$TOOLCHAIN/clang++" ] || { echo "NDK toolchain not found at $TOOLCHAIN" >&2; exit 1; }
HOST_PATH="$PATH"
export PATH="$TOOLCHAIN:$PATH"

# 1. Sources (pinned commit)
if [ ! -d "$SF_DIR/.git" ]; then
  git clone "$SF_REPO" "$SF_DIR"
fi
if [ "$(git -C "$SF_DIR" rev-parse HEAD)" != "$SF_COMMIT" ]; then
  git -C "$SF_DIR" fetch --depth 1 origin "$SF_COMMIT" || git -C "$SF_DIR" fetch origin
  git -C "$SF_DIR" checkout --force --detach "$SF_COMMIT"
fi

# Local fixes for the native (non-WASM) code path; applied idempotently.
for patch in "$ROOT"/native/stockfish/patches/*.patch; do
  if git -C "$SF_DIR" apply --check "$patch" 2>/dev/null; then
    git -C "$SF_DIR" apply "$patch"
    echo "applied $(basename "$patch")"
  elif ! git -C "$SF_DIR" apply --check --reverse "$patch" 2>/dev/null; then
    echo "patch does not apply: $patch" >&2; exit 1
  fi
done

cd "$SF_DIR/src"
# 2. Lite NNUE net (nn-61e7af4bb97d.nnue), downloaded + sha256-verified by scripts/net.sh
make net LITE_NET=yes

build_one() { # <ARCH> <COMPCXX or ""> <COMP> <output path>
  local arch="$1" cxx="$2" comp="$3" dest="$4"
  make clean >/dev/null
  local args=(-j"$JOBS" build ARCH="$arch" COMP="$comp" LITE_NET=yes ENGINE_VERSION="\"$ENGINE_VERSION\"")
  [ -n "$cxx" ] && args+=(COMPCXX="$cxx")
  echo ">>> make ${args[*]}"
  make "${args[@]}"
  mkdir -p "$(dirname "$dest")"
  "$TOOLCHAIN/llvm-strip" -o "$dest" stockfish
  chmod 755 "$dest"
  echo ">>> wrote $dest ($(du -h "$dest" | cut -f1))"
}

for abi in "${ABIS[@]}"; do
  case "$abi" in
    # Plain armv8 (NEON, no dotprod) so it runs on every arm64 phone.
    arm64-v8a) build_one armv8 "aarch64-linux-android${API}-clang++" ndk "$JNILIBS/arm64-v8a/libstockfish.so" ;;
    # Android x86_64 ABI guarantees SSE4.2 + POPCNT (emulator / Chromebooks).
    x86_64) build_one x86-64-sse41-popcnt "x86_64-linux-android${API}-clang++" ndk "$JNILIBS/x86_64/libstockfish.so" ;;
    *) echo "unsupported abi: $abi" >&2; exit 1 ;;
  esac
done

if [ "$BUILD_HOST" = yes ]; then
  # Host (glibc) build with the system g++, for UCI smoke tests only (Android binaries need bionic).
  # NDK toolchain must be off PATH here, otherwise gcc picks up the NDK's lld as "ld".
  PATH="$HOST_PATH" build_one x86-64-sse41-popcnt "" gcc "$OUT/host/stockfish"
fi
make clean >/dev/null

# 3. GPL-3 licence travels with the APK
cp "$SF_DIR/Copying.txt" "$ROOT/android/app/src/main/assets/STOCKFISH-LICENSE.txt"
echo "done"
