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

        return []
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
