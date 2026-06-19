/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

import { C2paHlsBridge } from './C2paHlsBridge'
import { C2paMp4Bridge } from './C2paMp4Bridge'
import { type C2paBridge, type C2PAConfig, type TrustSettings } from './C2paBridge'
import { C2paManifestHelper } from './C2paManifestHelper'
import { C2paFormatedItemType, type C2PAValidationStatus, type GenerativeContentLevel } from './C2paManifestHelper'

export { type Action, type Manifest, type ValidationState } from '@contentauth/c2pa-web'

export {
    C2paHlsBridge,
    C2paMp4Bridge,
    C2paManifestHelper,
    C2paFormatedItemType,
    type C2PAValidationStatus,
    type GenerativeContentLevel,
    type C2paBridge,
    type C2PAConfig,
    type TrustSettings
}
