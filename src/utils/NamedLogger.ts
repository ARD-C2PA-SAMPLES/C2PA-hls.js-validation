/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */

/**
 * Interface for named logging methods.
 * Can be mixed into any object to provide standardized log output with a consistent prefix.
 */
export interface NamedLogger {
    log: (...input: any[]) => void
    warn: (...input: any[]) => void
    error: (...input: any[]) => void
}

/**
 * Mixin that injects named logging capabilities (log, warn, error) into any object.
 * All output is prefixed with the provided name to make console logs traceable per instance or context.
 *
 * Example:
 * ```ts
 * class MyService implements NamedLogger {
 *   log!: (...input: any[]) => void;
 *   warn!: (...input: any[]) => void;
 *   error!: (...input: any[]) => void;
 *
 *   constructor() {
 *     withNamedLogger(this, 'MyService')
 *   }
 * }
 * ```
 *
 * @param target The object to extend with logging methods.
 * @param name   The prefix label used in all console output.
 * @returns      The extended object with logging functionality.
 */
export function withNamedLogger<T extends object> (target: T, name: string): T & NamedLogger {
    return Object.assign(target, {
        log (...input: any[]) {
            // eslint-disable-next-line no-restricted-properties,@typescript-eslint/no-unsafe-argument
            window.console.log(`[${name}]`, ...input)
        },
        warn (...input: any[]) {
            // eslint-disable-next-line no-restricted-properties,@typescript-eslint/no-unsafe-argument
            window.console.warn(`[${name}]`, ...input)
        },
        error (...input: any[]) {
            // eslint-disable-next-line no-restricted-properties,@typescript-eslint/no-unsafe-argument
            window.console.error(`[${name}]`, ...input)
        }
    })
}
