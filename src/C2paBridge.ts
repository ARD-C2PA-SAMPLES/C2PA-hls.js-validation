/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import { type Settings, type TrustSettings } from '@contentauth/c2pa-web'
import { type Interval } from '@flatten-js/interval-tree'
import { type C2paManifestHelper } from './C2paManifestHelper'
import { type NamedLogger, withNamedLogger } from './utils/NamedLogger'
import { createEngine } from './engine/createEngine'
import { type C2paEngine } from './engine/C2paEngine'

export interface C2PAConfig {
    enableTrustListVerification: boolean
    /**
     * Override the WASM source URL. Use this when your bundler (e.g. Vite) rewrites
     * the default URL and causes an integrity mismatch.
     */
    wasmSrc?: string
    /**
     * Custom C2PA trust settings. When provided together with `enableTrustListVerification: true`,
     * these are used directly instead of fetching the default list from the Content
     * Credentials trust store (`verify.contentauthenticity.org/trust/*`).
     */
    trust?: TrustSettings
    /**
     * Custom CAWG identity trust settings. Merged into the SDK settings when provided.
     */
    cawgTrust?: TrustSettings
    /**
     * Evaluate the `cawg.identity` assertion's signer against the C2PA trust list
     * as well. By default (and per c2pa-rs) the CAWG identity is checked against a
     * separate, empty trust policy, so an identity signed by an otherwise-trusted
     * C2PA signer is still reported `signingCredential.untrusted` and the asset
     * cannot reach `Trusted`. When `true` and no explicit `cawgTrust` is given, the
     * resolved C2PA trust resources are reused for the CAWG identity, so an
     * allow-listed signer that also signs the identity assertion validates as
     * `Trusted`. Opt-in: leaving it `false` keeps the standard, stricter default.
     */
    enableCawgIdentityTrustVerification?: boolean
}

export type { TrustSettings }

export interface C2paBridge {
    getC2PAMetaByTimeCode: (timeCode: number) => C2paManifestHelper | null
    getTamperedWithIntervals: () => Interval[]
    libReady: () => boolean
    dispose: () => void
}

export class AbstractC2PABridge implements NamedLogger, C2paBridge {
    log!: (...args: any[]) => void
    warn!: (...args: any[]) => void
    error!: (...args: any[]) => void

    protected readonly config: C2PAConfig
    protected c2pa: C2paEngine | null = null
    protected c2paTookitSettings: Settings | null = null

    constructor (config: C2PAConfig = {
        enableTrustListVerification: false
    }) {
        withNamedLogger(this, this.constructor.name)
        this.config = config
        this.initC2PA()
    }

    /**
     * Retrieves the C2PA manifest metadata associated with a specific timecode
     * of the currently playing stream.
     *
     * @param timeCode - The playback position in seconds.
     * @returns A C2PAManifestReader instance or null if not found.
     * @abstract
     */
    getC2PAMetaByTimeCode (timeCode: number): C2paManifestHelper | null {
        throw new Error('Method not implemented.')
    }

    /**
     * Returns a list of intervals that represent tampered (invalid) segments
     * in the current stream level.
     *
     * @returns An array of Interval objects for invalid segments.
     * @abstract
     */
    getTamperedWithIntervals (): Interval[] {
        throw new Error('Method not implemented.')
    }

    /**
     * Returns status of c2pa library (i.e. ready to use)
     */
    libReady (): boolean {
        return this.c2pa !== null
    }

    /**
     * Unregisters the fragment listener and disposes of the C2PA runtime.
     * Should be called when the adapter is no longer needed.
     */
    dispose (): void {
        this.c2pa?.dispose?.()
    }

    /**
     * Fetches a trust-related resource file from the Content Credentials trust store.
     *
     * Uses the canonical verifier host directly: `contentcredentials.org/trust/*`
     * 301-redirects here and serves no CORS headers (so a browser fetch is blocked
     * by the redirect), whereas `verify.contentauthenticity.org` responds 200 with
     * `Access-Control-Allow-Origin: *`.
     *
     * @param file - The name of the file to load (e.g., 'anchors.pem', 'allowed.sha256.txt').
     * @returns A promise resolving to the content of the requested file as a string.
     */
    private async loadTrustResource (file: string): Promise<string> {
        const res = await fetch(`https://verify.contentauthenticity.org/trust/${file}`)

        return await res.text()
    }

    /**
     * Loads all required trust configuration resources in parallel and
     * constructs a `ToolkitSettings` object for trust verification.
     *
     * Downloads:
     * - `anchors.pem`: Trust anchor certificates
     * - `allowed.sha256.txt`: Hashes of allowed content
     * - `store.cfg`: Trust store configuration
     *
     * @returns A promise that resolves to a fully populated `ToolkitSettings` object
     *          used for C2PA signature verification.
     */
    private async getToolkitSettings (): Promise<Settings> {
        const trust: TrustSettings = this.config.trust ?? await this.loadRemoteTrustSettings()
        // Explicit cawgTrust wins; otherwise reuse the C2PA trust list for the
        // CAWG identity only when opted in (see `enableCawgIdentityTrustVerification`).
        const cawgTrust = this.config.cawgTrust ??
            (this.config.enableCawgIdentityTrustVerification ? trust : undefined)
        return {
            trust,
            ...(cawgTrust ? { cawgTrust } : {}),
            verify: { verifyTrust: true }
        }
    }

    private async loadRemoteTrustSettings (): Promise<TrustSettings> {
        const [trustAnchors, allowedList, trustConfig] = await Promise.all(
            ['anchors.pem', 'allowed.sha256.txt', 'store.cfg'].map(f => this.loadTrustResource(f))
        )
        return { trustAnchors, allowedList, trustConfig }
    }

    /**
     * Asynchronously initializes the C2PA runtime by loading the WebAssembly module
     * and spawning a dedicated validation worker.
     *
     * @internal
     */
    private initC2PA (): void {
        // eslint-disable-next-line no-restricted-globals
        setTimeout(async () => {
            try {
                if (this.config.enableTrustListVerification) {
                    this.c2paTookitSettings = await this.getToolkitSettings()
                }
                this.c2pa = await createEngine(this.config, this.c2paTookitSettings ?? undefined, (...args) => { this.warn(...args) })

                this.log('C2PA runtime initialized', this.c2paTookitSettings)
                this.onRuntimeReady()
            } catch (err) {
                this.error('Failed to initialize c2pa:', err)
                this.dispose()
            }
        }, 1)
    }

    protected onRuntimeReady (): void {
        // to be overridden if needed
    }
}
