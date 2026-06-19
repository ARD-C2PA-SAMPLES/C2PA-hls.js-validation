/**
 * Helper functions to test if the manifest contains any generative AI indicators
 */

import type { Action, Manifest, ManifestAssertion } from '@contentauth/c2pa-web'

/**
 * Fields a `c2pa.actions.v2` action template may supply as defaults for every
 * action sharing its `action` label. See the C2PA "Action Templates" section:
 * https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html#_templates
 */
type ActionRecord = Record<string, unknown>

/**
 * Graded generative-AI classification for a single manifest:
 * - `'generated'`: fully synthetic media (trained-algorithmic source).
 * - `'partial'`: partly AI-assisted (composite with trained-algorithmic media,
 *   or a legacy generative-ai marker).
 * - `'none'`: action/generative assertions are present but none indicate AI.
 */
export type GenerativeContentLevel = 'none' | 'partial' | 'generated'

// --- Constants & helpers ---

// IPTC digitalSourceType values, split by the level they imply.
// Use Sets for O(1) membership checks.
const GEN_AI_DST_FULL = new Set<string>([
    'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
    'https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
])

const GEN_AI_DST_PARTIAL = new Set<string>([
    'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
    'https://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia'
])

/** Classifies a digitalSourceType string to its generative level, or `null` if non-generative. */
function dstLevel (dst: string | undefined): 'generated' | 'partial' | null {
    if (dst && GEN_AI_DST_FULL.has(dst)) return 'generated'
    if (dst && GEN_AI_DST_PARTIAL.has(dst)) return 'partial'
    return null
}

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

function isActionsV2 (a: ManifestAssertion): a is ManifestAssertion & { data: { actions: ActionRecord[] } } {
    if (a.label !== 'c2pa.actions.v2') return false
    if (!isRecord(a.data)) return false
    const actions = (a.data).actions
    return Array.isArray(actions)
}

// Fields an action may inherit from its template when omitted on the action itself.
const TEMPLATE_INHERITED_FIELDS = ['softwareAgent', 'softwareAgentIndex', 'description', 'digitalSourceType', 'icon'] as const

/**
 * Applies `c2pa.actions.v2` action-template defaults to each action. A template
 * provides default values (software agent, description, digitalSourceType, …)
 * for every action that shares its `action` label; values set directly on an
 * action take precedence. A no-op when no templates are present (e.g. when the
 * reader already resolved them, or for v1 actions).
 */
function applyActionTemplates (actions: ActionRecord[], templates: unknown): ActionRecord[] {
    if (!Array.isArray(templates) || templates.length === 0) {
        return actions
    }

    const byLabel = new Map<string, ActionRecord>()
    for (const template of templates) {
        if (isRecord(template) && typeof template.action === 'string' && !byLabel.has(template.action)) {
            byLabel.set(template.action, template)
        }
    }

    return actions.map(action => {
        const label = typeof action.action === 'string' ? action.action : undefined
        const template = label !== undefined ? byLabel.get(label) : undefined
        if (!template) {
            return action
        }

        const merged: ActionRecord = { ...action }
        for (const field of TEMPLATE_INHERITED_FIELDS) {
            if ((merged[field] ?? null) === null && (template[field] ?? null) !== null) {
                merged[field] = template[field]
            }
        }
        return merged
    })
}

/**
 * Returns the action records of an actions assertion, with v2 templates resolved.
 * Returns `null` if the assertion is not an actions assertion.
 */
function resolveAssertionActions (a: ManifestAssertion): { actions: ActionRecord[], isV2: boolean } | null {
    if (isActionsV2(a)) {
        const data = a.data as { actions: ActionRecord[], templates?: unknown }
        return { actions: applyActionTemplates(data.actions, data.templates), isV2: true }
    }
    if (isActionsV1(a)) {
        return { actions: (a.data as { actions: ActionRecord[] }).actions, isV2: false }
    }
    return null
}

/**
 * Returns the generative level of an ActionV1, or `null` if non-generative.
 */
function actionV1Level (action: Record<string, unknown>): 'generated' | 'partial' | null {
    const digitalSourceType = typeof action.digitalSourceType === 'string' ? (action.digitalSourceType) : undefined

    // direct digitalSourceType
    const direct = dstLevel(digitalSourceType)
    if (direct) return direct

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
            !!paramsSoftwareAgent
        ) {
            return dstLevel(paramsDigitalSourceType)
        }
    }

    return null
}

/**
 * Returns the generative level of an ActionV2, or `null` if non-generative.
 */
function actionV2Level (action: Record<string, unknown>): 'generated' | 'partial' | null {
    const digitalSourceType = typeof action.digitalSourceType === 'string' ? (action.digitalSourceType) : undefined
    return dstLevel(digitalSourceType)
}

// --- Public API ---

/**
 * Classifies the generative-AI involvement of a manifest.
 *
 * Inspects the `com.adobe.generative-ai`, `c2pa.actions` and `c2pa.actions.v2`
 * assertions. Returns the highest level found, `'none'` when such assertions
 * exist but none indicate AI, or `null` when no relevant assertions are present
 * at all (so callers can omit the section instead of asserting "no AI").
 */
export function generativeContentLevel (manifest: Manifest): GenerativeContentLevel | null {
    const assertions = manifest.assertions ?? []
    let hasRelevant = false
    let best: GenerativeContentLevel = 'none'

    for (const a of assertions) {
        // Legacy assertion: com.adobe.generative-ai → treated as partial unless a
        // stronger trained-algorithmic source is found elsewhere.
        if (isLegacyAssertion(a)) {
            hasRelevant = true
            if (best === 'none') best = 'partial'
            continue
        }

        const resolved = resolveAssertionActions(a)
        if (resolved) {
            hasRelevant = true
            for (const act of resolved.actions) {
                const level = resolved.isV2 ? actionV2Level(act) : actionV1Level(act)
                if (level === 'generated') return 'generated' // highest level, no need to look further
                if (level === 'partial') best = 'partial'
            }
        }
    }

    if (!hasRelevant) return null
    return best
}

/**
 * Returns the merged action list of a manifest, drawn from its `c2pa.actions`
 * and `c2pa.actions.v2` assertions (in that order), with v2 action templates
 * resolved so inherited fields (software agent, description, digitalSourceType)
 * appear directly on each action. Returns an empty array when no action
 * assertions are present.
 */
export function getManifestActions (manifest: Manifest): Action[] {
    const out: ActionRecord[] = []
    for (const a of manifest.assertions ?? []) {
        const resolved = resolveAssertionActions(a)
        if (resolved) {
            out.push(...resolved.actions)
        }
    }
    return out as unknown as Action[]
}

/**
 * Checks whether the manifest contains any generative AI content indicators.
 */
export function containsGenerativeContent (manifest: Manifest): boolean {
    const level = generativeContentLevel(manifest)
    return level === 'partial' || level === 'generated'
}
