# @nettrek/c2pa-hls-bridge

A lightweight integration layer that connects **C2PA verification** with **HLS.js** at fragment-level.  
It enables real-time validation of signed media segments using C2PA manifests while streaming via HLS.

---

## Features

- Intercepts fragment loading in HLS.js
- Extracts raw fragment bytes and validates them through a pluggable engine:
  `@contentauth/c2pa-web` (WASM, default) or `@nettrek/c2pa-web-crypto`
  (WebCrypto, opt-in — see [Engine selection](#engine-selection-experimental-webcrypto))
- Maintains a timecode-mapped interval tree for quick C2PA lookups
- Detects tampering, AI-generated content, missing signatures
- Minimal, high-level API (`C2paHlsBridge`, `C2paMp4Bridge`)

---

## Installation

```bash
npm install @nettrek/c2pa-hls-bridge
```

### Entry points

| Import | Engines | Use when |
|---|---|---|
| `@nettrek/c2pa-hls-bridge` | both bundled in | no bundler, or bundle size is not a concern |
| `@nettrek/c2pa-hls-bridge/chunked` | both left external | you want your bundler to code-split them |
| `@nettrek/c2pa-hls-bridge/helpers` | — | standalone helpers (`checkMp4ForC2paHeader`) |

Both bridge entries expose the identical API and types; they differ only in how
the engines are packaged. The default entry inlines them, so it works from a
plain `<script type="module">`. `./chunked` keeps `@contentauth/c2pa-web` and
`@nettrek/c2pa-web-crypto` as external imports so the consuming bundler
resolves them and emits them as separate chunks — with webpack, the
`webpackChunkName` magic comments in the engine factory are honoured, and the
WebCrypto chunk is only fetched when `enableExperimentalWebCrypto` is set.
Prefer `./chunked` in an application bundle: it keeps the engine you do not
use out of the initial payload.

```typescript
import { C2paHlsBridge } from '@nettrek/c2pa-hls-bridge/chunked'
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

### Engine selection (experimental WebCrypto)

The bridge runs on the WASM engine (`@contentauth/c2pa-web`) by default. The
experimental WebCrypto engine (`@nettrek/c2pa-web-crypto`, no WASM/worker) is
strictly opt-in:

```typescript
const bridge = new C2paHlsBridge({
  enableTrustListVerification: true,
  enableExperimentalWebCrypto: true, // use WebCrypto where crypto.subtle exists; WASM fallback
}, hls)
```

When disabled (default) the bridge always uses WASM, regardless of `crypto.subtle`.

### Custom trust settings (offline / local PKI)

```typescript
const bridge = new C2paHlsBridge({
  enableTrustListVerification: true,
  trust: { trustAnchors, allowedList, trustConfig },
  cawgTrust: { trustAnchors },
}, hls)
```

When `trust` is omitted the bridge fetches the default lists from `verify.contentauthenticity.org`
(the canonical C2PA verifier host — it serves the trust list with CORS headers, whereas
`contentcredentials.org/trust/*` only 301-redirects here without CORS).

### CAWG identity trust

The `cawg.identity` assertion's signer is evaluated against a **separate** trust
policy (matching c2pa-rs, whose default for it is empty). So a stream whose
identity assertion is signed by an otherwise-trusted C2PA signer is still
reported `signingCredential.untrusted` and never reaches `Trusted`. Supply
`cawgTrust` to control that policy, or set `enableCawgIdentityTrustVerification: true`
to reuse the resolved C2PA trust list for the identity as well:

```typescript
const bridge = new C2paHlsBridge({
  enableTrustListVerification: true,
  enableCawgIdentityTrustVerification: true, // identity signer judged against the C2PA list too
}, hls)
```

This is opt-in: leaving it off keeps the stricter standard default (identity
untrusted unless an explicit `cawgTrust` is configured).

#### Engine difference: how an untrusted identity is reported

The two engines agree on the *state* — a present but untrusted CAWG identity is
gating and caps the asset below `Trusted` either way — but they differ in how
they say so:

| Engine | Reported status |
|---|---|
| WebCrypto (`enableExperimentalWebCrypto: true`) | the differentiated `cawg.identity.untrusted`, on the identity URL |
| WASM (default) | the generic `signingCredential.untrusted`, indistinguishable from an untrusted C2PA claim signer |

So on the default WASM path you cannot tell from the status code whether it was
the C2PA claim signer or the CAWG identity signer that failed the trust check.
This is upstream behaviour, not a bridge limitation: the differentiation is
proposed in [c2pa-rs#2248](https://github.com/contentauth/c2pa-rs/pull/2248)
(issue [#2247](https://github.com/contentauth/c2pa-rs/issues/2247)) and is not
merged, so no released `@contentauth/c2pa-web` carries it —
`@nettrek/c2pa-web-crypto` implements the proposed model directly. If you need
the distinction on the WASM path before upstream lands it, point
`@contentauth/c2pa-web` at a patched build via your package manager's
`overrides`/`resolutions`; the bridge deliberately depends on the stock
release.

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
  enableExperimentalWebCrypto?: boolean          // opt into the WebCrypto engine; default false (WASM)
  enableCawgIdentityTrustVerification?: boolean  // judge the CAWG identity against the C2PA trust list too
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
  // Signature & validation
  containsSignature(): boolean
  getManifestStoreValidationState(): ValidationState | null   // "Valid" | "Trusted" | "Invalid"
  isValid(): boolean                                          // @deprecated – use getManifestStoreValidationState()
  getValidationErrors(): ValidationStatus[]

  // Manifest access
  getManifestStore(): ManifestStore | null
  getManifestMap(): Record<string, Manifest>
  getActiveManifest(): Manifest | null

  // Content & metadata
  containsAIGeneratedContent(): boolean
  getActions(manifest?: Manifest): Action[]
  getGenerativeContentLevel(manifest?: Manifest): GenerativeContentLevel | null
  getCumulativeGenerativeContentLevel(): GenerativeContentLevel | null
  getTrainingMiningUsage(manifest?: Manifest): TrainingMiningEntry[]
  getCreators(manifest?: Manifest): Creator[]
  getVerifiedIdentities(manifest?: Manifest): VerifiedIdentity[]
  getCustomMetadata(identifier: string, manifest?: Manifest): any | null
  getItem(item: C2paFormatedItemType): string | boolean

  // Ingredients
  getPlacedIngredients(manifest?: Manifest): PlacedIngredient[]
  getActionIngredient(action: Action, manifest?: Manifest): PlacedIngredient | null

  // Serialisation
  crJson(): Promise<any>    // canonical crJSON (c2pa-web ≥ 0.8.0)
  toString(): string        // pretty-printed JSON of the manifest store
}
```

| Method | Description |
|--------|-------------|
| `containsSignature()` | `true` if a C2PA manifest is present |
| `getManifestStoreValidationState()` | Three-state result: `"Valid"`, `"Trusted"`, or `"Invalid"` |
| `isValid()` | `true` for `"Valid"` or `"Trusted"` state — **deprecated**, prefer `getManifestStoreValidationState()` |
| `getValidationErrors()` | Array of validation errors, empty when valid |
| `getManifestStore()` | The raw underlying `ManifestStore` snapshot |
| `getActiveManifest()` | The currently active `Manifest` or `null` |
| `containsAIGeneratedContent()` | `true` if any manifest asserts AI-generated content |
| `getActions()` | The manifest's `c2pa.actions` entries |
| `getGenerativeContentLevel()` | Generative-content level asserted by one manifest, or `null` |
| `getCumulativeGenerativeContentLevel()` | Highest level across the whole manifest chain |
| `getTrainingMiningUsage()` | `cawg.training-mining` entries (falls back to the legacy `c2pa.*` form) |
| `getCreators()` | Creators from the CAWG/IPTC metadata assertions (`dc:creator`) |
| `getVerifiedIdentities()` | Identities from the `cawg.identity` assertion |
| `getCustomMetadata(id)` | Custom assertion data by label identifier |
| `getItem(type)` | Formatted string for `ISSUER`, `DATE`, or `VALIDATION_STATUS` |
| `getPlacedIngredients()` | Ingredients placed into the asset, with thumbnails where present |
| `getActionIngredient(action)` | The ingredient an action refers to, or `null` |
| `crJson()` | Canonical crJSON representation (requires c2pa-web ≥ 0.8.0) |
| `toString()` | Pretty-printed JSON of the full manifest store |

---

## References

- [C2PA Specification](https://c2pa.org/specifications/)
- [CAWG Identity Assertion](https://cawg.io/identity/)
- [HLS.js Documentation](https://github.com/video-dev/hls.js/)
- [@contentauth/c2pa-web](https://github.com/contentauth/c2pa-js) — the WASM engine
- [@nettrek/c2pa-web-crypto](https://www.npmjs.com/package/@nettrek/c2pa-web-crypto) — the WebCrypto engine

## Supporters

This open-source library is supported by [Westdeutscher Rundfunk](https://www.wdr.de) and CCAV (Competence Center Audio and Video).
