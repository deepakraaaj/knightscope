# KnightScope

**Every game teaches you something.** KnightScope reviews your finished chess games with Stockfish on your own device, remembers the mistakes you repeat, and turns them into practice positions taken from your own games.

It ships as one codebase in three forms:
- a static web app, installable as a PWA;
- an Android app (Capacitor), using native Stockfish;
- an iOS project (Capacitor), which must be built on a Mac.

There are no accounts, API keys or servers, and no review limits.

## Requirements

- Node.js 20 or later (tested with 22) and npm.
- Android builds also need the Android SDK and NDK, plus JDK 21.
- iOS builds need macOS with Xcode.

## Commands

```bash
npm install          # also copies the Stockfish lite engine into public/engines
npm run dev          # development server at http://localhost:5173
npm run build        # type-check + production build into dist/
npm run preview      # serve the production build locally
npm run test         # unit and integration tests (Vitest; runs the real Stockfish engine)
npx playwright install chromium   # once, before the first end-to-end run
npm run test:e2e     # end-to-end tests against the production build
```

## Deploying the web app

`dist/` is a fully static site. It uses relative paths and hash routing, so any static host works without rewrite rules:
- Netlify
- Vercel
- Cloudflare Pages
- GitHub Pages
- S3
- nginx

Serve `.wasm` files as `application/wasm`; most hosts already do. The service worker caches the app and the lite engine, so reviews you have already opened keep working offline.

**Optional stronger engine.** `npm run engine:full` copies the full Stockfish 19 build (about 94 MB) into `public/engines/`. Rebuild afterwards, and it becomes selectable in Settings. Some hosts reject files this large (for example Cloudflare Pages caps files at 25 MB); check yours first.

## Android

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug        # APK: android/app/build/outputs/apk/debug/app-debug.apk
```

- **Native engine.** The app includes native Stockfish 19 Lite, built with the NDK for arm64-v8a and x86_64 by `native/build-android-engine.sh`.
  - It runs multi-threaded as a child process and is selected automatically on first launch.
  - On a host build it produced the same search as the WASM engine (identical node counts).
  - If the native engine fails to start, the app falls back to the WASM engine.
  - 32-bit (armeabi-v7a) phones use the WASM engine.
- **Background analysis.** Batch analysis keeps running while the app is minimised. A foreground service with a notification and a partial wake lock keeps it alive.
- **JDK 21.** `android/gradle.properties` sets `org.gradle.java.home` to this machine's JDK 21. Change that path on other machines.
- **Release builds** are covered in the next section. The foreground service uses the `specialUse` type, so the Play Console will ask for a short written justification.

### Signed release APK

```bash
npm run android:release      # builds, signs and verifies release/KnightScope-<version>.apk (+ .sha256)
```

- **Signing key.** The script needs the key, which is never committed. Provide it in one of two ways:
  - **Locally:** `android/keystore.properties`, containing `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. The `storeFile` path is relative to `android/`.
  - **In CI:** the environment variables `KS_STORE_FILE`, `KS_STORE_PASSWORD`, `KS_KEY_ALIAS` and `KS_KEY_PASSWORD`.
- **Create a new key** with:
  `keytool -genkeypair -keystore android/keystore/knightscope-release.jks -alias knightscope -keyalg RSA -keysize 4096 -validity 10000`
- **Back up the keystore and its password somewhere safe.** Android only installs updates signed with the same key. If you lose it, users must uninstall and reinstall, which deletes their local data.
- **Each new release:** bump `versionCode` and `versionName` in `android/app/build.gradle`.

To rebuild the native engine:

```bash
native/build-android-engine.sh            # both ABIs; downloads the pinned source and network
native/build-android-engine.sh --host     # Linux host binary, for testing UCI output
```

## iOS

```bash
npm run build && npx cap sync ios && npx cap open ios   # on a Mac with Xcode
```

- iOS uses the WASM engine; a native engine is not included yet.
- iOS does not allow this kind of background execution, so analysis pauses when the app leaves the foreground. It resumes from the last saved position.

## How it works

- **Engine.** Stockfish 19 (stockfish.js) runs in a Web Worker and is driven over UCI by a strictly serialized command queue. Results are always normalised to White's perspective.
- **Three-stage analysis.**
  - Stage A screens every position quickly.
  - Stage B searches deeper only on critical positions.
  - Stage C builds the review.
  - The queue is stored in IndexedDB, so it survives a page reload and resumes from the last analysed position.
- **Labels and categories.** Classifications, accuracy, confidence and mistake categories are documented in [docs/CLASSIFICATION.md](docs/CLASSIFICATION.md). They are KnightScope's own heuristics and are not equivalent to any other site's scores.
- **Storage.** All data lives in IndexedDB on the device. Export and restore are in Settings.

## Code layout

```
src/
  app/               App root, router, PWA registration, error boundary
  components/        ui/ primitives, layout/ shell, chess/ board, eval bar, graph, move list
  features/          dashboard, import, review, analysis, mistake-memory, training, analytics, settings
  engine/            uci/ parser, stockfish/ engine + pool, scheduler/ three-stage analyzer + queue, native/ bridges, cache/
  chess/             pgn/, positions/, classification/, tactics/, accuracy/, explanations/, openings/
  storage/           Dexie database (versioned migrations) and repositories
tests/unit           Vitest (real Stockfish via Node)      tests/e2e   Playwright
native/              Android Stockfish build script and patch
```

## Licences

- KnightScope is distributed under **GPL-3.0-or-later**, because it bundles Stockfish (GPL-3.0).
  - The engine licence ships with the app in `engines/STOCKFISH-LICENSE.txt`.
  - Engine source: https://github.com/nmrugg/stockfish.js. The Android build uses the commit and patch pinned in `native/`.
- Opening names come from the [Lichess chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0).
