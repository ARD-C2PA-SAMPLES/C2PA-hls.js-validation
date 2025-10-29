/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import { type C2paSdk, createC2pa, type Settings } from '@contentauth/c2pa-web'
import { type Interval } from '@flatten-js/interval-tree'
import { type C2paManifestHelper } from './C2paManifestHelper'
import { type NamedLogger, withNamedLogger } from './utils/NamedLogger'

import wasmAssetUrl from '@contentauth/c2pa-web/resources/c2pa.wasm'

export interface C2PAConfig {
    enableTrustListVerification: boolean
}

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
    protected c2pa: C2paSdk | null = null
    protected c2paTookitSettings: Settings | null = null

    constructor (config: C2PAConfig = {
        enableTrustListVerification: false
    }) {
        withNamedLogger(this, 'AbstractC2PABridge')
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
     * @param file - The name of the file to load (e.g., 'anchors.pem', 'allowed.sha256.txt').
     * @returns A promise resolving to the content of the requested file as a string.
     */
    private async loadTrustResource (file: string): Promise<string> {
        const res = await fetch(`https://contentcredentials.org/trust/${file}`)

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
        const [trustAnchors, allowedList, trustConfig] = await Promise.all(
            ['anchors.pem', 'allowed.sha256.txt', 'store.cfg'].map(this.loadTrustResource)
        )

        return {
            trust: {
                trustConfig,
                trustAnchors,
                allowedList
            },
            verify: {
                verifyTrust: true
            }
        }
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
                this.c2pa = await createC2pa({ wasmSrc: wasmAssetUrl, settings: this.c2paTookitSettings ?? undefined })

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
