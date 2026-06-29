/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import {
    type Action, type Manifest, type ManifestStore, type ValidationStatus, type ValidationState, type Reader
} from '@contentauth/c2pa-web'
import { containsGenerativeContent, generativeContentLevel, getManifestActions, type GenerativeContentLevel } from './utils/containsGenerativeContent'

export { type GenerativeContentLevel } from './utils/containsGenerativeContent'

/**
 * Represents the validation status of a C2PA manifest.
 */
export interface C2PAValidationStatus {
    code: string
    url?: string
    explanation?: string
}

/**
 * Enumeration for selecting formatted display values from a manifest.
 */
export enum C2paFormatedItemType {
    ISSUER,
    DATE,
    VALIDATION_STATUS
}

/**
 * A single training / data-mining usage permission, drawn from the CAWG
 * `cawg.training-mining` assertion (or the legacy `c2pa.training-mining`).
 *
 * See {@link https://cawg.io/training-and-data-mining/1.1/}.
 */
export interface TrainingMiningEntry {
    /** The usage category key, e.g. `cawg.ai_generative_training` or the legacy `c2pa.*` form. */
    key: string
    /** Whether the use is permitted. Standard values: `allowed`, `notAllowed`, `constrained`. */
    use: string
    /** Free-text constraint description; present when `use` is `constrained`. */
    constraintInfo?: string
}

/**
 * A normalized creator/author entry, sourced from the schema.org CreativeWork
 * assertion (typed) or CAWG-era metadata assertions (`cawg.metadata` / `stds.iptc`).
 */
export interface Creator {
    name: string
    /** schema.org `@type` (`Organization` | `Person`) when known, otherwise `undefined`. */
    type?: string
}

/**
 * A verified identity declared by the CAWG identity assertion (`cawg.identity`).
 *
 * See {@link https://cawg.io/identity/}.
 */
export interface VerifiedIdentity {
    /** Display name of the verified identity (person, account holder, or signer). */
    name: string
    /**
     * The kind of identity, e.g. `cawg.social_media` / `cawg.document_verification`
     * for an ICA verifiable credential, or `cawg.x509.cose` when the identity is
     * derived from the signing certificate issuer.
     */
    type?: string
    /** Identity-provider name, e.g. `linkedin`, when reported (ICA form only). */
    provider?: string
    /** Public URI for the identity (e.g. a social profile), when reported. */
    uri?: string
}

/**
 * A reference to a binary resource (e.g. a thumbnail) in the manifest store,
 * resolvable to bytes via {@link C2paManifestHelper.getResourceDataUrl}.
 */
export interface ResourceThumbnail {
    /** JUMBF URI of the resource within the store. */
    identifier: string
    /** MIME type of the resource, e.g. `image/jpeg`. */
    format: string
}

/**
 * An ingredient placed into a manifest via a `c2pa.placed` action, resolved to
 * display info. See {@link C2paManifestHelper.getPlacedIngredients}.
 */
export interface PlacedIngredient {
    /** Ingredient title, falling back to the source manifest's title; `null` if unknown. */
    title: string | null
    /** Ingredient MIME type, falling back to the source manifest's format; `null` if unknown. */
    format: string | null
    /** The ingredient relationship (`parentOf` | `componentOf` | `inputTo`) when reported. */
    relationship?: string
    /** A representative thumbnail for the placed ingredient, when one is resolvable. */
    thumbnail?: ResourceThumbnail | null
}

/** Narrowed alias for a manifest ingredient (avoids a direct c2pa-types import). */
type C2paIngredient = NonNullable<Manifest['ingredients']>[number]

/** Normalizes a resource reference to a {@link ResourceThumbnail}, or `null`. */
function toThumbnail (ref: { identifier?: unknown, format?: unknown } | null | undefined): ResourceThumbnail | null {
    if (ref && typeof ref.identifier === 'string' && typeof ref.format === 'string') {
        return { identifier: ref.identifier, format: ref.format }
    }
    return null
}

/**
 * The 0-based ingredient index an action acts on, parsed from the `__N` suffix of
 * its ingredient-assertion URI (no suffix → index 0), or `null` when the action
 * carries no ingredient reference. Applies to any ingredient-referencing action
 * (e.g. `c2pa.opened`, `c2pa.placed`).
 */
function actionIngredientIndex (action: Action): number | null {
    const params = action.parameters
    const ref = params?.ingredients?.[0] ?? params?.ingredient ?? null
    const url = typeof ref?.url === 'string' ? ref.url : null
    if (url === null) {
        return null
    }
    const match = url.match(/c2pa\.ingredient(?:\.v\d+)?(?:__(\d+))?$/)
    if (!match) {
        return null
    }
    return match[1] !== undefined ? Number.parseInt(match[1], 10) : 0
}

/** Best-available thumbnail for a placed ingredient: ingredient → source manifest → source's ingredients. */
function pickIngredientThumbnail (ingredient: C2paIngredient, source: Manifest | undefined): ResourceThumbnail | null {
    return toThumbnail(ingredient.thumbnail) ??
        toThumbnail(source?.thumbnail) ??
        (source?.ingredients ?? []).map(sub => toThumbnail(sub.thumbnail)).find(t => t !== null) ??
        null
}

/**
 * Wrapper class for accessing and formatting information from a C2PA read result.
 * Provides helpers for signature presence, validation status, custom metadata, and formatted output.
 */
export class C2paManifestHelper {
    constructor (private readonly store: ManifestStore, private readonly reader?: Reader) {
    }

    /**
     * Returns the raw underlying {@link ManifestStore}, or `null` if unavailable.
     */
    getManifestStore (): ManifestStore | null {
        return this.store ?? null
    }

    /**
     * Returns the manifest store as crJSON (the canonical C2PA JSON representation
     * introduced in c2pa-web v0.8.0). Requires a {@link Reader} to be passed to the
     * constructor; returns `null` otherwise.
     */
    async crJson (): Promise<any> {
        return this.reader?.crJson() ?? null
    }

    /**
     * Checks if the result contains a valid manifest store (i.e., a signature exists).
     */
    containsSignature (): boolean {
        return (this.store?.active_manifest ?? null) != null
    }

    /**
     * Returns the three-state validation result of the manifest store:
     * `"Valid"`, `"Trusted"`, or `"Invalid"`. Returns `null` if no manifest is present.
     */
    getManifestStoreValidationState (): ValidationState | null {
        return this.store?.validation_state ?? null
    }

    /**
     * Returns whether the manifest store passes validation.
     * Considers both `"Valid"` and `"Trusted"` states as valid.
     * Falls back to checking for absence of validation errors when `validation_state` is unavailable.
     *
     * @deprecated Use {@link getManifestStoreValidationState} for the full three-state result.
     */
    isValid (): boolean {
        const state = this.getManifestStoreValidationState()
        if (state != null) {
            return state === 'Valid' || state === 'Trusted'
        }
        return this.containsSignature() &&
            (this.store?.validation_status?.length ?? 0) === 0
    }

    /**
     * Returns any validation errors associated with the manifest.
     */
    getValidationErrors (): ValidationStatus[] {
        if (!this.containsSignature()) {
            return [{
                code: 'not-found',
                url: '',
                explanation: 'Missing signature'
            }]
        }

        return this.store?.validation_status ?? []
    }

    /**
     * Returns the full manifest map, indexed by manifest ID.
     */
    getManifestMap (): Record<string, Manifest> {
        return this.store?.manifests ?? {}
    }

    getActiveManifest (): Manifest | null {
        const activeManifestId = this.store?.active_manifest ?? null
        if (!activeManifestId) return null
        return this.store?.manifests?.[activeManifestId] ?? null
    }

    /**
     * Retrieves custom metadata for a specific assertion identifier.
     *
     * @param identifier A string key used in the manifest assertions (may be application-specific).
     * @param manifest An optional manifest object to use for lookup. Defaults to the active manifest.
     * @returns The custom metadata value associated with the identifier, or `null` if not found.
     */
    getCustomMetadata (identifier: string, manifest?: Manifest): any | null {
        let manifestToUse = manifest
        if (!manifestToUse) {
            if (this.store?.active_manifest !== null && this.store?.active_manifest !== undefined) {
                manifestToUse = this.store?.manifests?.[this.store.active_manifest]
            }
        }
        if (!manifestToUse) return null

        const assertion = manifestToUse?.assertions?.find(a => a.label === identifier)
        return assertion?.data ?? null
    }

    /**
     * Checks whether any of the manifests contain AI-generated content.
     *
     * Iterates through all available manifests in the manifest store and
     * tries to detect the presence of C2PA actions indicating AI-generated
     * content (e.g. `c2pa.created`).
     *
     * @returns {boolean} `true` if at least one manifest contains evidence
     * of AI-generated content, otherwise `false`.
     */
    containsAIGeneratedContent (): boolean {
        const activeManifestId = this.store?.active_manifest ?? null
        if (!activeManifestId) return false

        for (const manifest of Object.values(this.store?.manifests ?? {})) {
            if (containsGenerativeContent(manifest)) { return true }
        }

        return false
    }

    /**
     * Returns the merged action list of a manifest, drawn from its `c2pa.actions`
     * and `c2pa.actions.v2` assertions (in that order), with v2 action templates
     * resolved so template-inherited fields (software agent, description,
     * digitalSourceType) appear directly on each action. Defaults to the active
     * manifest. Returns an empty array when no action assertions are present.
     *
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getActions (manifest?: Manifest): Action[] {
        const target = manifest ?? this.getActiveManifest()
        if (!target) return []
        return getManifestActions(target)
    }

    /**
     * Returns the training / data-mining usage permissions of a manifest.
     *
     * Prefers the current CAWG assertion `cawg.training-mining` (C2PA ≥ 2.2) and
     * falls back to the legacy `c2pa.training-mining` label. Returns an empty array
     * when neither assertion is present or the shape is unrecognized. Defaults to
     * the active manifest.
     *
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getTrainingMiningUsage (manifest?: Manifest): TrainingMiningEntry[] {
        const data = (this.getCustomMetadata('cawg.training-mining', manifest)
            ?? this.getCustomMetadata('c2pa.training-mining', manifest)) as
            { entries?: Record<string, { use?: unknown, constraint_info?: unknown } | null> } | null

        const entries = data?.entries
        if (entries === null || entries === undefined || typeof entries !== 'object') {
            return []
        }

        const out: TrainingMiningEntry[] = []
        for (const [key, entry] of Object.entries(entries)) {
            const use = entry?.use
            if (typeof use !== 'string') {
                continue
            }
            const result: TrainingMiningEntry = { key, use }
            if (typeof entry?.constraint_info === 'string') {
                result.constraintInfo = entry.constraint_info
            }
            out.push(result)
        }
        return out
    }

    /**
     * Returns the normalized creator/author list of a manifest.
     *
     * Prefers the typed schema.org CreativeWork authors when present (they carry an
     * `@type`), and otherwise falls back to the CAWG-era metadata assertions
     * (`cawg.metadata` / `stds.iptc`), reading `dc:creator` (a string array).
     * Returns an empty array when no creators are declared. Defaults to the active
     * manifest.
     *
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getCreators (manifest?: Manifest): Creator[] {
        const creativeWork = this.getCustomMetadata('stds.schema-org.CreativeWork', manifest) as
            { author?: Array<{ '@type'?: unknown, name?: unknown } | null> } | null

        const fromCreativeWork = (creativeWork?.author ?? [])
            .filter((a): a is { '@type'?: unknown, name: string } => a !== null && a !== undefined && typeof a.name === 'string')
            .map(a => ({ name: a.name, type: typeof a['@type'] === 'string' ? a['@type'] : undefined }))

        if (fromCreativeWork.length > 0) {
            return fromCreativeWork
        }

        for (const label of ['cawg.metadata', 'stds.iptc']) {
            const metadata = this.getCustomMetadata(label, manifest) as { 'dc:creator'?: unknown } | null
            const creators = metadata?.['dc:creator']
            if (Array.isArray(creators)) {
                const names = creators.filter((c): c is string => typeof c === 'string')
                if (names.length > 0) {
                    return names.map(name => ({ name }))
                }
            }
        }

        // Last resort: named identities verified via the CAWG identity assertion
        // (e.g. a person bound to the signer through a social-media credential).
        // The x509.cose form only repeats the certificate issuer (already shown as
        // the signer), so it is excluded here. Names are left untyped — CAWG
        // identity types are not schema.org `@type` values.
        const verified = this.getVerifiedIdentities(manifest).filter(v => v.type !== 'cawg.x509.cose')
        if (verified.length > 0) {
            return verified.map(v => ({ name: v.name }))
        }

        return []
    }

    /**
     * Returns the verified identities declared by a manifest's CAWG identity
     * assertion (`cawg.identity`). Two assertion shapes are recognized:
     *
     * - the Identity Claims Aggregation (ICA) verifiable credential, which lists
     *   `verifiedIdentities` (named persons/accounts verified via a provider), and
     * - the `cawg.x509.cose` form, whose `signature_info.issuer` names the signer
     *   (emitted with `type: 'cawg.x509.cose'`).
     *
     * Returns an empty array when no identity assertion is present. Defaults to
     * the active manifest.
     *
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getVerifiedIdentities (manifest?: Manifest): VerifiedIdentity[] {
        const data = this.getCustomMetadata('cawg.identity', manifest) as {
            verifiedIdentities?: Array<{ type?: unknown, name?: unknown, username?: unknown, uri?: unknown, provider?: { name?: unknown } | null } | null>
            signature_info?: { issuer?: unknown } | null
        } | null
        if (data === null || typeof data !== 'object') {
            return []
        }

        const out: VerifiedIdentity[] = []

        // ICA verifiable-credential form: one entry per verified identity.
        for (const vi of data.verifiedIdentities ?? []) {
            if (vi === null || vi === undefined) {
                continue
            }
            const name = typeof vi.name === 'string'
                ? vi.name
                : (typeof vi.username === 'string' ? vi.username : null)
            if (name === null) {
                continue
            }
            const entry: VerifiedIdentity = { name }
            if (typeof vi.type === 'string') {
                entry.type = vi.type
            }
            if (typeof vi.uri === 'string') {
                entry.uri = vi.uri
            }
            if (vi.provider !== null && vi.provider !== undefined && typeof vi.provider.name === 'string') {
                entry.provider = vi.provider.name
            }
            out.push(entry)
        }

        // x509.cose form: the signing certificate's issuer names the signer.
        if (out.length === 0 && typeof data.signature_info?.issuer === 'string') {
            out.push({ name: data.signature_info.issuer, type: 'cawg.x509.cose' })
        }

        return out
    }

    /**
     * Returns the graded generative-AI classification of a manifest:
     * `'generated'`, `'partial'`, or `'none'`. Returns `null` when the manifest
     * carries no action/generative assertions, so callers can hide the section
     * rather than assert "no AI". Defaults to the active manifest.
     *
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getGenerativeContentLevel (manifest?: Manifest): GenerativeContentLevel | null {
        const target = manifest ?? this.getActiveManifest()
        if (!target) return null
        return generativeContentLevel(target)
    }

    /**
     * Returns the highest generative-AI level across *all* manifests in the store,
     * not just the active one.
     *
     * The active manifest is frequently a packaging/publishing step (e.g. a
     * repackaged-for-delivery signature) that carries no generative assertions,
     * while the actual AI evidence lives in ingredient manifests. This walks the
     * whole provenance chain and returns the strongest signal: `'generated'` if any
     * manifest is fully synthetic, otherwise `'partial'` if any is partly
     * AI-assisted, otherwise `'none'` if relevant action/generative assertions
     * exist but none indicate AI, and `null` when no manifest carries any such
     * assertions at all (so callers can omit the section rather than assert "no AI").
     */
    getCumulativeGenerativeContentLevel (): GenerativeContentLevel | null {
        let best: GenerativeContentLevel | null = null
        for (const manifest of Object.values(this.store?.manifests ?? {})) {
            const level = generativeContentLevel(manifest)
            if (level === 'generated') {
                return 'generated' // strongest level, no need to look further
            }
            if (level === 'partial') {
                best = 'partial'
            } else if (level === 'none' && best === null) {
                best = 'none'
            }
        }
        return best
    }

    /**
     * Returns the ingredients placed into a manifest through its `c2pa.placed`
     * actions, resolved to display info.
     *
     * Each `c2pa.placed` action references an ingredient assertion
     * (`c2pa.ingredient.v2|v3`, optionally `__N`-suffixed for duplicates); the
     * suffix is the 0-based index into the manifest's `ingredients` list. Title and
     * format fall back to the ingredient's source manifest when the ingredient
     * carries none, and a representative thumbnail is resolved from the ingredient,
     * else its source manifest, else the first thumbnail among the source
     * manifest's own ingredients. Defaults to the active manifest.
     *
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getPlacedIngredients (manifest?: Manifest): PlacedIngredient[] {
        const target = manifest ?? this.getActiveManifest()
        if (!target) return []

        const out: PlacedIngredient[] = []
        for (const action of this.getActions(target)) {
            if (action.action !== 'c2pa.placed') {
                continue
            }
            const placed = this.getActionIngredient(action, target)
            if (placed) {
                out.push(placed)
            }
        }
        return out
    }

    /**
     * Resolves the ingredient a single action acts on (e.g. `c2pa.opened`,
     * `c2pa.placed`) to display info, or `null` when the action references no
     * ingredient. The action's ingredient-assertion URI is mapped to the manifest's
     * `ingredients` list by its `__N` index; title/format/thumbnail fall back to the
     * ingredient's source manifest as in {@link getPlacedIngredients}. Defaults to
     * the active manifest.
     *
     * @param action The action to resolve (as returned by {@link getActions}).
     * @param manifest An optional manifest object. Defaults to the active manifest.
     */
    getActionIngredient (action: Action, manifest?: Manifest): PlacedIngredient | null {
        const target = manifest ?? this.getActiveManifest()
        if (!target) return null
        const ingredients = target.ingredients ?? []

        const index = actionIngredientIndex(action)
        const ingredient = index !== null ? ingredients[index] : undefined
        if (!ingredient) {
            return null
        }
        const source = typeof ingredient.active_manifest === 'string'
            ? this.store?.manifests?.[ingredient.active_manifest]
            : undefined
        return {
            title: (ingredient.title ?? source?.title) ?? null,
            format: (ingredient.format ?? source?.format) ?? null,
            relationship: ingredient.relationship ?? undefined,
            thumbnail: pickIngredientThumbnail(ingredient, source)
        }
    }

    /**
     * Resolves a manifest resource (e.g. an ingredient thumbnail) to a `data:` URL,
     * using the {@link Reader} passed to the constructor. Returns `null` when no
     * reader is available or the resource cannot be read.
     *
     * @param resource The resource reference to resolve (identifier + MIME type).
     */
    async getResourceDataUrl (resource: ResourceThumbnail): Promise<string | null> {
        if (!this.reader) {
            return null
        }
        try {
            const bytes = await this.reader.resourceToBytes(resource.identifier)
            if (!bytes || bytes.length === 0) {
                return null
            }
            // base64-encode in chunks to avoid blowing the argument limit of
            // String.fromCharCode on large buffers.
            let binary = ''
            const chunkSize = 0x8000
            for (let offset = 0; offset < bytes.length; offset += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
            }
            return `data:${resource.format};base64,${btoa(binary)}`
        } catch {
            return null
        }
    }

    /**
     * Returns a human-readable string representation for common metadata fields.
     *
     * @param item The metadata field to extract from the manifest.
     */
    getItem (item: C2paFormatedItemType): string | boolean {
        const activeManifestId = this.store?.active_manifest ?? null
        if (!activeManifestId) return 'unknown'

        const activeManifest = this.store?.manifests?.[activeManifestId]
        if (!activeManifest) return 'unknown'

        switch (item) {
            case C2paFormatedItemType.ISSUER:
                return activeManifest.signature_info?.issuer ?? 'unknown'

            case C2paFormatedItemType.DATE: {
                const timeValue = activeManifest.signature_info?.time ?? null
                const date = timeValue ? new Date(timeValue) : null
                return date
                    ? new Intl.DateTimeFormat('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: '2-digit'
                    }).format(date)
                    : 'unknown'
            }

            case C2paFormatedItemType.VALIDATION_STATUS:
                return this.containsSignature()
                    ? this.isValid() ? 'Passed' : 'Failed'
                    : 'Unknown'
            default:
                return 'unknown'
        }
    }

    /**
     * Converts the raw result to a pretty-printed JSON string (safe against circular references).
     */
    toString (): string {
        const cache = new Set()
        return JSON.stringify(this.store, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.has(value)) return
                cache.add(value)
            }
            return value
        }, 4)
    }

}
