# @nettrek/c2pa-hls-bridge

A lightweight integration layer that connects **C2PA WebAssembly verification** with **HLS.js** at fragment-level.  
It enables real-time validation of signed media segments using C2PA manifests while streaming via HLS.

---

## Features

- Intercepts fragment loading in HLS.js
- Extracts raw fragment bytes and validates them via `@contentauth/c2pa-web` (WASM)
- Maintains a timecode-mapped interval tree for quick C2PA lookups
- Detects tampering, AI-generated content, missing signatures
- Minimal, high-level API (`C2paHlsBridge`, `C2paMp4Bridge`)

---

## Installation

```bash
npm install @nettrek/c2pa-hls-bridge
```

### Build from source

```bash
npm install
npm run build
```

---

## Usage

### HLS.js streaming

```typescript
import Hls from 'hls.js'
import { C2paHlsBridge } from '@nettrek/c2pa-hls-bridge'

const video = document.querySelector('video')
const hls = new Hls()
const bridge = new C2paHlsBridge({ enableTrustListVerification: false }, hls)

hls.on(Hls.Events.MEDIA_ATTACHED, () => {
  hls.loadSource('https://example.com/master.m3u8')
})
hls.attachMedia(video)

video.addEventListener('timeupdate', () => {
  const reader = bridge.getC2PAMetaByTimeCode(video.currentTime)
  if (!reader) return

  console.log(reader.containsSignature())
  console.log(reader.isValid())
  console.log(reader.containsAIGeneratedContent())
  console.log(reader.getValidationErrors())
})
```

### Standalone MP4

```typescript
import { C2paMp4Bridge } from '@nettrek/c2pa-hls-bridge'

const bridge = new C2paMp4Bridge(
  { enableTrustListVerification: false },
  'https://example.com/video.mp4'
)
// wait for libReady() before querying
const reader = bridge.getC2PAMetaByTimeCode(0)
```

### Custom trust settings (offline / local PKI)

```typescript
const bridge = new C2paHlsBridge({
  enableTrustListVerification: true,
  trust: { trustAnchors, allowedList, trustConfig },
  cawgTrust: { trustAnchors },
}, hls)
```

When `trust` is omitted the bridge fetches the default lists from `contentcredentials.org`.

### Vite / bundler WASM override

Vite's dependency optimiser can rewrite the WASM URL and break the integrity check.
Pass your own resolved URL to avoid this:

```typescript
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url'

const bridge = new C2paHlsBridge({ enableTrustListVerification: false, wasmSrc }, hls)
```

---

## API

### `C2paHlsBridge`

```typescript
class C2paHlsBridge {
  constructor(config: C2PAConfig, hls: Hls)

  getC2PAMetaByTimeCode(timeCode: number): C2paManifestHelper | null
  getTamperedWithIntervals(): Interval[]
  libReady(): boolean
  dispose(): void
}
```

### `C2paMp4Bridge`

```typescript
class C2paMp4Bridge {
  constructor(config: C2PAConfig, url: string)

  getC2PAMetaByTimeCode(timeCode: number): C2paManifestHelper | null
  getTamperedWithIntervals(): Interval[]
  libReady(): boolean
  dispose(): void
}
```

### `C2PAConfig`

```typescript
interface C2PAConfig {
  enableTrustListVerification: boolean
  wasmSrc?: string        // override WASM URL (e.g. for Vite)
  trust?: TrustSettings   // custom C2PA trust — skips remote fetch when set
  cawgTrust?: TrustSettings
}

interface TrustSettings {
  trustAnchors?: string
  allowedList?: string
  trustConfig?: string
}
```

### `C2paManifestHelper`

```typescript
class C2paManifestHelper {
  containsSignature(): boolean
  isValid(): boolean
  containsAIGeneratedContent(): boolean
  getValidationErrors(): ValidationStatus[]
  getManifestMap(): Record<string, Manifest>
  getActiveManifest(): Manifest | null
  getCustomMetadata(identifier: string, manifest?: Manifest): any | null
  getItem(item: C2paFormatedItemType): string | boolean
  toString(): string
}
```

| Method | Description |
|--------|-------------|
| `containsSignature()` | `true` if a C2PA manifest is present |
| `isValid()` | `true` if the manifest passes validation without errors |
| `containsAIGeneratedContent()` | `true` if any manifest asserts AI-generated content |
| `getValidationErrors()` | Array of validation errors, empty when valid |
| `getActiveManifest()` | The currently active manifest or `null` |
| `getCustomMetadata(id)` | Custom assertion data by label identifier |
| `getItem(type)` | Formatted string for `ISSUER`, `DATE`, or `VALIDATION_STATUS` |
| `toString()` | Pretty-printed JSON of the full manifest store |

---

## References

- [C2PA Specification](https://c2pa.org/specifications/)
- [HLS.js Documentation](https://github.com/video-dev/hls.js/)
- [@contentauth/c2pa-web](https://github.com/contentauth/c2pa-js)

## Supporters

This open-source library is supported by [Westdeutscher Rundfunk](https://www.wdr.de) and CCAV (Competence Center Audio and Video).
