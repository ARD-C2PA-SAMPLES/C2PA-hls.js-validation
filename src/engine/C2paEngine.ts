/**
 * @copyright
 * (c) 2026 netTrek GmbH & Co. KG
 *
 * The C2PA engine surface the bridge consumes — the reader subset shared by the
 * WebCrypto engine (@nettrek/c2pa-web-crypto) and the WASM engine
 * (@contentauth/c2pa-web). `AbstractC2PABridge` talks to this, not to a concrete
 * SDK, so the engine can be swapped at runtime.
 */

import { type Reader, type Settings } from '@contentauth/c2pa-web'

export type { Reader, Settings }

export interface C2paEngine {
    reader: {
        fromBlob: (format: string, blob: Blob, settings?: Settings) => Promise<Reader | null>
        fromBlobFragment: (format: string, init: Blob, fragment: Blob, settings?: Settings) => Promise<Reader | null>
    }
    dispose: () => void
}
