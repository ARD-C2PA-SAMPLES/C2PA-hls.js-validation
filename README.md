# @nettrek/c2pa-hls-bridge

A lightweight integration layer that connects **C2PA WebAssembly verification** with **HLS.js** at fragment-level.  
It enables real-time validation of signed media segments using C2PA manifests while streaming via HLS.  
Demo: [0.1.0 build](https://clients.nettrek.de/wdr/c2pa-hls-bridge/0.1.0/)
---

## Features

- ✅ Intercepts fragment loading in HLS.js
- ✅ Extracts raw fragment bytes and validates them via `@contentauth/c2pa-web` (WASM)
- ✅ Maintains a time-code mapped interval tree for quick C2PA lookups
- ✅ Detects tampering, AI-generated content, missing signatures
- ✅ Exposes a minimal, high-level API (`C2paHlsBridge`)

---

## Installation

### From npm
```bash
npm install @nettrek/c2pa-hls-bridge
```

### Local install (for development)
```bash
npm install ../path/to/dist
```

### Build the library (local development)
```bash
npm install
npm run build
```

## Usage

### Minimal example
```typescript
import Hls from "hls.js";
import { C2paHlsBridge } from "@nettrek/c2pa-hls-bridge";

const video = document.querySelector("video");
const hls = new Hls();

const bridge = new C2paHlsBridge({ enableTrustListVerification: false }, hls);

hls.on(Hls.Events.MEDIA_ATTACHED, () => {
  hls.loadSource("https://example.com/master.m3u8");
});

hls.attachMedia(video);

video.addEventListener("timeupdate", () => {
  const reader = bridge.getC2PAMetaByTimeCode(video.currentTime);
  if (!reader) return;

  reader.containsSignature();
  reader.isValid();
  reader.containsAIGeneratedContent();
  reader.getValidationErrors();
});
```

### API

#### C2paHlsBridge
```typescript
class C2paHlsBridge {
  constructor(config: C2PAConfig, hls: HlsInstance)

  getC2PAMetaByTimeCode(timeCode: number): C2paManifestHelper | null
  getTamperedWithIntervals(): Interval[]
  libReady(): boolean
  dispose(): void
}
```

- `constructor(config: C2PAConfig, hls: HlsInstance)` - Creates a new `C2paHlsBridge` instance for the given HLS.js instance.
- `getC2PAMetaByTimeCode(time: number)` - Returns a `C2paManifestHelper` for the active segment at the given playback time. The ManifestHelper exposes methods for validating the segment and retrieving metadata.
- `getTamperedWithIntervals()` - Returns an array of intervals that have been tampered with.
- `libReady()` - Returns `true` if the C2PA WebAssembly library is ready.
- `dispose()` - Disposes the `C2paHlsBridge` instance.

#### C2PAConfig
```typescript
interface C2PAConfig {
    enableTrustListVerification: boolean;
}
```
- `enableTrustListVerification` - Enables or disables trust list verification (requires network access)

#### C2paManifestHelper
```typescript
class C2paManifestHelper {
    containsSignature(): boolean
    isValid(): boolean
    containsAIGeneratedContent(): boolean
    getValidationErrors(): ValidationStatus[]
    getManifestMap(): Record<string, Manifest>
    getActiveManifest(): Manifest | null
    getCustomMetadata (identifier: string, manifest?: Manifest): any | null
    getItem (item: C2paFormatedItemType): string | boolean
    toString(): string
```

- `containsSignature()` – Returns true if a valid manifest/signature is present.
- `isValid()` – Indicates whether the manifest passes validation without errors.
- `containsAIGeneratedContent()` – Detects if any manifest indicates AI-generated content.
- `getValidationErrors()` – Returns an array of validation errors if present.
- `getManifestMap()` – Returns the full set of manifests indexed by manifest ID.
- `getActiveManifest()` – Returns the currently active manifest or null.
- `getCustomMetadata(identifier, manifest?)` – Retrieves custom assertion data by identifier. If no manifest is provided, the active manifest is used.
- `getItem(type: C2paFormatedItemType)` – Returns a formatted human-readable value (enum one of C2paFormatedItemType - issuer, date, status).
- `toString()` – Returns a pretty-printed JSON representation of the full manifest store (recursion-safe)

## References
- [C2PA Specification]
- [HLS.js Documentation]

[C2PA Specification]: https://c2pa.org/specifications/
[HLS.js Documentation]: https://github.com/video-dev/hls.js/

## Supporters
- This Opensource Repo is being supported by Westdeutscher Rundfunk, CCAV (Competence Center Audio and Video).
