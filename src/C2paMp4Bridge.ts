/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import { Interval } from '@flatten-js/interval-tree'
import { C2paManifestHelper } from './C2paManifestHelper'
import { AbstractC2PABridge, type C2PAConfig } from './C2paBridge'

export class C2paMp4Bridge extends AbstractC2PABridge {
    #manifestReader: C2paManifestHelper | null = null
    readonly #url: string

    constructor (config: C2PAConfig = {
        enableTrustListVerification: false
    }, url: string) {
        super(config)

        this.#url = url
    }

    override getC2PAMetaByTimeCode (timeCode: number): C2paManifestHelper | null {
        return this.#manifestReader
    }

    override getTamperedWithIntervals (): Interval[] {
        if (!this.#manifestReader) return []
        return this.#manifestReader.isValid() ? [] : [new Interval(0, Number.MAX_SAFE_INTEGER)]
    }

    override dispose (): void {
        super.dispose()
    }

    protected override async onRuntimeReady (): Promise<void> {
        try {
            const mp4blob = await fetch(this.#url)
            const blob = await mp4blob.blob()

            const c2paResult = await this.c2pa?.reader.fromBlob(blob.type, blob)
            if (!c2paResult) { throw new Error('No c2pa data found') }

            const store = await c2paResult.manifestStore()
            this.#manifestReader = new C2paManifestHelper(store)
            this.log('c2paResult', c2paResult)
        } catch (err) {
            this.error('Error reading c2pa data from url:', this.#url, err)
        }
    }
}
