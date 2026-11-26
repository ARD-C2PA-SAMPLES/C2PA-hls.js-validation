/**
 * @copyright
 * (c) 2026 netTrek GmbH & Co. KG
 *
 * Builds the engine settings for trust verification from the bundled trust lists.
 * C2PA 2.4 §14.4 requires the official C2PA Trust List and C2PA TSA Trust List; the
 * frozen CAI interim list is added by default because current publisher signers and
 * their TSAs are only on it. Each list is its own chunk, loaded only with trust enabled.
 */

import type { Settings, TrustSettings } from '@contentauth/c2pa-web'
import type { C2PAConfig } from '../C2paBridge'

const join = (...pems: Array<string | undefined>): string => pems.filter(Boolean).join('\n')

export async function resolveTrustSettings (config: C2PAConfig): Promise<Settings> {
    const useOfficial = config.trustLists?.official ?? true
    const useInterim = config.trustLists?.interim ?? true

    const [official, interim] = await Promise.all([
        useOfficial ? import(/* webpackChunkName: "c2pa-trust-official" */ './official') : undefined,
        useInterim ? import(/* webpackChunkName: "c2pa-trust-interim" */ './interim') : undefined
    ])

    const bundled: TrustSettings = {
        trustAnchors: join(official?.C2PA_TRUST_LIST, interim?.INTERIM_TRUST_ANCHORS),
        ...(interim ? { allowedList: interim.INTERIM_ALLOWED_LIST, trustConfig: interim.INTERIM_TRUST_CONFIG } : {})
    }
    // The interim list carries the TSA roots together with the signer roots.
    const bundledTsa: TrustSettings = { trustAnchors: join(official?.C2PA_TSA_TRUST_LIST, interim?.INTERIM_TRUST_ANCHORS) }

    const trust = config.trust ?? bundled
    const tsaTrust = config.tsaTrust ?? bundledTsa
    // Explicit cawgTrust wins; otherwise reuse the C2PA trust list for the CAWG
    // identity only when opted in (see `enableCawgIdentityTrustVerification`).
    const cawgTrust = config.cawgTrust ?? (config.enableCawgIdentityTrustVerification ? trust : undefined)
    return {
        trust,
        tsaTrust,
        ...(cawgTrust ? { cawgTrust } : {}),
        verify: { verifyTrust: true }
    }
}
