/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import {
    type Manifest, type ManifestStore, type ValidationStatus, type ValidationState
} from '@contentauth/c2pa-web'
import { containsGenerativeContent } from './utils/containsGenerativeContent'

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
 * Wrapper class for accessing and formatting information from a C2PA read result.
 * Provides helpers for signature presence, validation status, custom metadata, and formatted output.
 */
export class C2paManifestHelper {
    constructor (private readonly store: ManifestStore) {
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
