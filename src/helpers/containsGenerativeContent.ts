/**
 * Helper functions to test if the manifest contains any generative AI indicators
 */

import type { Manifest, ManifestAssertion } from '@contentauth/c2pa-web'

// --- Constants & helpers ---

// Use a Set for O(1) membership checks
const GEN_AI_DST = new Set<string>([
    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
    'https://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia'
])

function isRecord (x: unknown): x is Record<string, unknown> {
    return !!x && typeof x === 'object'
}

function getParamString (
    params: Record<string, unknown> | undefined,
    key: string
): string | undefined {
    const v = params?.[key]
    return typeof v === 'string' ? v : undefined
}

// --- Narrowing guards (minimal) ---

function isLegacyAssertion (a: ManifestAssertion): boolean {
    if (a.label !== 'com.adobe.generative-ai') return false
    if (!isRecord(a.data)) return false
    const { description, version } = a.data
    return typeof description === 'string' && typeof version === 'string'
}

function isActionsV1 (a: ManifestAssertion): a is ManifestAssertion & { data: { actions: Array<Record<string, unknown>> } } {
    if (a.label !== 'c2pa.actions') return false
    if (!isRecord(a.data)) return false
    const actions = (a.data).actions
    return Array.isArray(actions)
}

function isActionsV2 (a: ManifestAssertion): a is ManifestAssertion & { data: { actions: Array<Record<string, unknown>> } } {
    if (a.label !== 'c2pa.actions.v2') return false
    if (!isRecord(a.data)) return false
    const actions = (a.data).actions
    return Array.isArray(actions)
}

/**
 * Returns true if an ActionV1 matches generative AI conditions.
 */
function actionV1IsGenerative (action: Record<string, unknown>): boolean {
    const digitalSourceType = typeof action.digitalSourceType === 'string' ? (action.digitalSourceType) : undefined

    // direct digitalSourceType
    if (digitalSourceType && GEN_AI_DST.has(digitalSourceType)) return true

    // third-party via parameters on c2pa.opened
    const actionName = typeof action.action === 'string' ? (action.action) : undefined
    const parameters = isRecord(action.parameters) ? (action.parameters) : undefined

    if (actionName === 'c2pa.opened' && parameters) {
        const paramsDigitalSourceType = getParamString(parameters, 'com.adobe.digitalSourceType')
        const provider = getParamString(parameters, 'com.adobe.type')
        const paramsSoftwareAgent = getParamString(parameters, 'com.adobe.details') // presence required in legacy logic

        if (
            paramsDigitalSourceType &&
            provider === 'remoteProvider.3rdParty' &&
            GEN_AI_DST.has(paramsDigitalSourceType) &&
            !!paramsSoftwareAgent
        ) {
            return true
        }
    }

    return false
}

/**
 * Returns true if an ActionV2 matches generative AI conditions.
 */
function actionV2IsGenerative (action: Record<string, unknown>): boolean {
    const digitalSourceType = typeof action.digitalSourceType === 'string' ? (action.digitalSourceType) : undefined
    return !!(digitalSourceType && GEN_AI_DST.has(digitalSourceType))
}

// --- Public API ---

/**
 * Checks whether the manifest contains any generative AI content indicators.
 */
export function containsGenerativeContent (manifest: Manifest): boolean {
    const assertions = manifest.assertions ?? []
    for (const a of assertions) {
        // Legacy assertion: com.adobe.generative-ai
        if (isLegacyAssertion(a)) return true

        // Actions v1
        if (isActionsV1(a)) {
            const actions = (a.data as { actions: Array<Record<string, unknown>> }).actions
            for (const act of actions) {
                if (actionV1IsGenerative(act)) return true
            }
        }

        // Actions v2
        if (isActionsV2(a)) {
            const actions = (a.data as { actions: Array<Record<string, unknown>> }).actions
            for (const act of actions) {
                if (actionV2IsGenerative(act)) return true
            }
        }
    }
    return false
}
