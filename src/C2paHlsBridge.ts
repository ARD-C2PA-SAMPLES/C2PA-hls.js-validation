/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import type Hls from 'hls.js'
import type { LoaderCallbacks, FragLoadingData } from 'hls.js'
import IntervalTree, { Interval } from '@flatten-js/interval-tree'
import { C2paManifestHelper } from './C2paManifestHelper'
import { AbstractC2PABridge, type C2PAConfig } from './C2paBridge'
import { Events } from './utils/HlsJsEvents'

interface LocalFragment {
    sn: number
    start: number
    end: number
    segmentValid: boolean
    data: ArrayBuffer
}

interface FragValidationType {
    initSegmentData: Blob
    queuedForCheckFragments: LocalFragment[]
    timeCodeMappingTree: IntervalTree
    validatorQueueRunning: boolean
}

/**
 * A bridge class that connects HLS.js with the C2PA.js runtime to enable real-time
 * fragment validation for fMP4-based HLS streams (VOD and live).
 *
 * It intercepts fragment loading, extracts raw binary data, validates via the C2PA WebAssembly API,
 * and maps manifest data to timecode ranges using an interval tree.
 */
export class C2paHlsBridge extends AbstractC2PABridge {
    readonly #hlsInstance: Hls
    #fragValidationMap: Record<string, FragValidationType> = {}

    // Single stable reference for the FRAG_LOADING listener. `.bind()` produces a
    // new function each call, so binding inline at registration time made the
    // handler impossible to remove in dispose() (off() never matched) — leaking a
    // listener per stream reload. Bind once and reuse for both on() and off().
    readonly #onFragLoading = this.onFragLoading.bind(this)

    /**
     * Creates a new C2PAHlsBridge instance.
     * @param hls - The HLS.js player instance to attach fragment hooks to.
     */
    constructor (config: C2PAConfig = {
        enableTrustListVerification: false
    }, hls: Hls) {
        super(config)

        this.#hlsInstance = hls
        this.registerHLSEvents()
    }

    override getC2PAMetaByTimeCode (timeCode: number): C2paManifestHelper | null {
        const key = this.getCurrentLevelKey()
        const result = this.#fragValidationMap[key]?.timeCodeMappingTree.search(new Interval(timeCode, timeCode))
        this.log(`[${key}] Searching for timecode ${timeCode}:`, result, this.#fragValidationMap[key]?.timeCodeMappingTree.items)
        return result?.[0]?.manifestReader ?? null
    }

    override getTamperedWithIntervals (): Interval[] {
        const key = this.getCurrentLevelKey()
        return this.#fragValidationMap[key]?.timeCodeMappingTree.items
            .filter(item => !item.value.manifestReader.valid)
            .map(item => item.value.interval) ?? []
    }

    override dispose (): void {
        super.dispose()
        this.#hlsInstance.off(Events.FRAG_LOADING, this.#onFragLoading)
    }

    /**
     * The C2PA runtime initializes asynchronously (WASM load). For short or
     * already-buffered streams, every fragment can finish loading *before* the
     * runtime is ready — in which case the FRAG_LOADING-driven queue bailed on
     * `!this.c2pa` and nothing would ever re-trigger it. Now that the runtime is
     * available, drain any level that still has pending fragments.
     */
    protected override onRuntimeReady (): void {
        for (const [levelKey, entry] of Object.entries(this.#fragValidationMap)) {
            if (!entry.validatorQueueRunning && entry.queuedForCheckFragments.length > 0) {
                void this.runValidationQueue(levelKey)
            }
        }
    }

    /**
     * Registers the HLS.js fragment loading event to hook into raw segment data.
     * @internal
     */
    private registerHLSEvents (): void {
        this.#hlsInstance.on(Events.FRAG_LOADING, this.#onFragLoading)
    }

    /**
     * Intercepts each fragment loading call and injects logic to capture raw fragment bytes
     * for later C2PA validation. Automatically starts the validation queue if not running.
     *
     * @param _eventName - The name of the HLS.js event (unused).
     * @param fragment - The fragment loading metadata.
     * @internal
     */
    private onFragLoading (_eventName: Events.FRAG_LOADING, fragment: FragLoadingData): void {
        const loader = fragment.frag.loader

        // @ts-expect-error: Callbacks may not be typed if loader is overridden
        const callbacks: LoaderCallbacks<any> = loader.callbacks
        const originalOnSuccess = callbacks.onSuccess

        callbacks.onSuccess = (response, stats, context, networkDetails) => {
            this.handleFragmentSuccess(fragment, response)
            originalOnSuccess(response, stats, context, networkDetails)

            const fragIndexKey = `${fragment.frag.type}-${fragment.frag.level}`
            const entry = this.#fragValidationMap[fragIndexKey]

            if (entry && !entry.validatorQueueRunning) {
                void this.runValidationQueue(fragIndexKey)
            }
        }
    }

    /**
     * Processes a successfully loaded fragment by storing it in the validation queue.
     * If it's an init segment, it initializes the validation structure.
     *
     * @param fragment - The fragment loading metadata.
     * @param response - The response object from the HLS loader.
     * @internal
     */
    private handleFragmentSuccess (fragment: FragLoadingData, response: any): void {
        const responseData = response.data as ArrayBuffer
        const fragIndexKey = `${fragment.frag.type}-${fragment.frag.level}`

        const data = new ArrayBuffer(responseData.byteLength)
        new Uint8Array(data).set(new Uint8Array(responseData))

        if (fragment.frag.sn === 'initSegment') {
            if (!this.#fragValidationMap[fragIndexKey]) {
                this.#fragValidationMap[fragIndexKey] = {
                    initSegmentData: new Blob([data], { type: 'video/mp4' }),
                    timeCodeMappingTree: new IntervalTree(),
                    queuedForCheckFragments: [],
                    validatorQueueRunning: false
                }
            }
        } else {
            const entry = this.#fragValidationMap[fragIndexKey]
            if (!entry) {
                this.error(`[${fragIndexKey}] Critical: Missing initSegment for fragment.`)
                return
            }

            this.warn(`[${fragIndexKey}] Fragment ${fragment.frag.sn} received. Start: ${fragment.frag.start}, End: ${fragment.frag.start + fragment.frag.duration}`)
            entry.queuedForCheckFragments.push({
                sn: fragment.frag.sn,
                start: fragment.frag.start,
                end: fragment.frag.start + fragment.frag.duration,
                segmentValid: false,
                data
            })
        }
    }

    /**
     * Returns a key based on the current HLS level, used to group fragments for validation.
     * Currently hardcoded to "main-" as video track prefix.
     *
     * @returns A string key representing the current stream level.
     * @internal
     */
    private getCurrentLevelKey (): string {
        // TODO: Replace "main" with per-track keys when supporting audio/video separately
        return 'main-' + this.#hlsInstance.currentLevel
    }

    /**
     * Processes the validation queue sequentially for a given track level.
     * Validates fragments using the C2PA runtime and updates the interval tree
     * with the parsed result.
     *
     * @param levelKey - The fragment group key (e.g., "video-0", "audio-1").
     * @internal
     */
    private async runValidationQueue (levelKey: string): Promise<void> {
        const entry = this.#fragValidationMap[levelKey]
        if (!entry || entry.validatorQueueRunning || !this.c2pa) {
            this.warn(`[${levelKey}] C2PA not ready or queue already running.`)
            return
        }

        if (entry.initSegmentData.size === 0) {
            this.warn(`[${levelKey}] Missing init segment data.`)
            return
        }

        if (entry.queuedForCheckFragments.length === 0) {
            this.warn(`[${levelKey}] No fragments to validate.`)
            return
        }

        entry.validatorQueueRunning = true
        // Drain the queue in a try/finally so a fragment that yields no manifest
        // or throws can never wedge the queue (leaving validatorQueueRunning stuck
        // true would stop all further validation for this level). New fragments
        // appended while draining are picked up by the loop.
        try {
            let fragment = entry.queuedForCheckFragments.shift()
            while (fragment) {
                try {
                    this.log(`[${levelKey}] Validating segment ${fragment.sn}`)

                    const fragmentBlob = new Blob([fragment.data], { type: 'video/mp4' })
                    const manifestInfo = await this.c2pa.reader.fromBlobFragment(entry.initSegmentData.type, entry.initSegmentData, fragmentBlob)
                    if (!manifestInfo) {
                        this.warn(`[${levelKey}] No manifest data found for segment ${fragment.sn}.`)
                        continue
                    }

                    const store = await manifestInfo.manifestStore()
                    const manifestReader = new C2paManifestHelper(store, manifestInfo)

                    const interval = new Interval(fragment.start, fragment.end)

                    // Prevent duplicates
                    entry.timeCodeMappingTree.search(interval).forEach(seg => {
                        if (seg.interval.low === interval.low && seg.interval.high === interval.high) {
                            this.warn(`[${levelKey}] Duplicate interval found – replacing`)
                            entry.timeCodeMappingTree.remove(interval, seg)
                        }
                    })

                    this.log(`[${levelKey}] Mapping interval ${interval.low}-${interval.high}`, manifestReader)
                    entry.timeCodeMappingTree.insert(interval, { manifestReader, interval })

                    if (!manifestReader.containsSignature()) {
                        this.warn(`Segment ${levelKey}.${fragment.sn} has no signature.`)
                    } else if (!manifestReader.isValid()) {
                        this.warn(`Segment ${levelKey}.${fragment.sn} failed validation.`, manifestReader.getValidationErrors())
                    }

                    this.log(`[${levelKey}] Validation complete for segment ${fragment.sn}`)
                } catch (err) {
                    this.error(`[${levelKey}] Validation failed for segment ${fragment.sn}.`, err)
                } finally {
                    // Clear data reference (manual memory hint) regardless of outcome
                    // @ts-expect-error: manual memory hit
                    delete fragment.data
                }

                fragment = entry.queuedForCheckFragments.shift()
            }
        } finally {
            entry.validatorQueueRunning = false
        }
    }
}
