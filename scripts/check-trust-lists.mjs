// Warns when a bundled official trust list is past its announced NextUpdate, i.e. C2PA
// has (or should have) issued a newer list. Regenerate with `npm run gen:trust-lists`.
// Never fails the build: a stale list still validates, it just lags behind upstream.
import { readFileSync } from 'node:fs'

const src = readFileSync('src/trust/official.ts', 'utf8')
const now = Date.now()
for (const name of ['C2PA_TRUST_LIST_INFO', 'C2PA_TSA_TRUST_LIST_INFO']) {
    const m = src.match(new RegExp(`${name} = (\\{[^\\n]*\\})`))
    const info = m ? JSON.parse(m[1]) : null
    if (!info) { console.warn(`⚠ ${name}: metadata not found in src/trust/official.ts`); continue }
    const next = Date.parse(info.nextUpdate)
    if (Number.isNaN(next) || next < now) {
        console.warn(`⚠ ${name}: past NextUpdate ${info.nextUpdate} (issued ${info.issued}) — run npm run gen:trust-lists`)
    } else {
        console.log(`✓ ${name}: issued ${info.issued}, next update ${info.nextUpdate}`)
    }
}
