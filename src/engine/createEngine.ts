/**
 * @copyright
 * (c) 2026 netTrek GmbH & Co. KG
 *
 * Selects the C2PA engine at runtime:
 *
 * - **WASM** (@contentauth/c2pa-web) — the default. Used whenever the experimental
 *   WebCrypto engine is not enabled, or when `crypto.subtle` is unavailable.
 * - **WebCrypto** (@nettrek/c2pa-web-crypto) — experimental, opt-in via
 *   `config.enableExperimentalWebCrypto`. Used where `crypto.subtle` is available;
 *   lightweight, no WASM/worker. Per-asset, if it throws on an input it doesn't
 *   support, that asset falls back to the WASM engine (logged).
 */

import type { Settings } from '@contentauth/c2pa-web'
import wasmAssetUrl from '@contentauth/c2pa-web/resources/c2pa.wasm'
import { type C2paEngine } from './C2paEngine'
import { type C2PAConfig } from '../C2paBridge'

type Log = (...args: any[]) => void

// Parameter shape of the WASM engine's factory, referenced type-only (the runtime
// factory is loaded lazily below), so no static import of the engine remains.
type WasmC2paConfig = Parameters<typeof import('@contentauth/c2pa-web').createC2pa>[0]

const hasWebCrypto = (): boolean =>
    typeof globalThis !== 'undefined' &&
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined'

function wasmConfig (config: C2PAConfig, settings: Settings | undefined): WasmC2paConfig {
    return { wasmSrc: config.wasmSrc ?? wasmAssetUrl, settings }
}

/**
 * Wraps the WebCrypto engine so that an asset it throws on is retried with the
 * WASM engine (created lazily, once). Returning `null` (no C2PA data) is a valid
 * result and is NOT a fallback trigger.
 */
function withWasmFallback (primary: C2paEngine, makeWasm: () => Promise<C2paEngine>, log: Log): C2paEngine {
    let wasm: Promise<C2paEngine> | null = null
    const wasmEngine = (): Promise<C2paEngine> => (wasm ??= makeWasm())

    const guard = async <T>(label: string, run: (e: C2paEngine) => Promise<T>): Promise<T> => {
        try {
            return await run(primary)
        } catch (err) {
            log(`[engine] WebCrypto engine failed on ${label}, falling back to WASM:`, err)
            return await run(await wasmEngine())
        }
    }

    return {
        reader: {
            fromBlob: async (format, blob, settings) => guard('fromBlob', e => e.reader.fromBlob(format, blob, settings)),
            fromBlobFragment: async (format, init, fragment, settings) => guard('fromBlobFragment', e => e.reader.fromBlobFragment(format, init, fragment, settings))
        },
        dispose: () => { primary.dispose(); void wasm?.then(e => e.dispose()) }
    }
}

/** Creates the C2PA engine for the given config + resolved trust settings. */
export async function createEngine (config: C2PAConfig, settings: Settings | undefined, log: Log): Promise<C2paEngine> {
    // Each engine is loaded via its own dynamic import so a downstream bundler emits
    // it as a separate chunk. Under the chunked build the magic comments survive verbatim,
    // so a downstream webpack emits c2pa-engine-wasm / c2pa-engine-webcrypto chunks.
    // Under the self-contained build (no externals) esbuild
    // inlines them, so the same source stays usable without a bundler.
    const makeWasm = async (): Promise<C2paEngine> => {
        const { createC2pa } = await import(/* webpackChunkName: "c2pa-engine-wasm" */ '@contentauth/c2pa-web')
        return await createC2pa(wasmConfig(config, settings)) as C2paEngine
    }

    // The WebCrypto engine is experimental and strictly opt-in; default to WASM.
    if (!config.enableExperimentalWebCrypto) {
        log('[engine] using WASM engine (experimental WebCrypto disabled)')
        return makeWasm()
    }

    if (!hasWebCrypto()) {
        log('[engine] using WASM engine (crypto.subtle unavailable)')
        return makeWasm()
    }

    log('[engine] using experimental WebCrypto engine')
    // The two libs declare structurally-identical but nominally-distinct Settings.
    const { createC2pa: createWebCryptoC2pa } = await import(/* webpackChunkName: "c2pa-engine-webcrypto" */ '@nettrek/c2pa-web-crypto')
    const webCrypto = await createWebCryptoC2pa({ settings: settings as never }) as unknown as C2paEngine
    return withWasmFallback(webCrypto, makeWasm, log)
}
