/**
 * @copyright
 * (c) 2025 netTrek GmbH & Co. KG – All rights reserved.
 *
 * This source code is part of the C2PA-HLS integration library.
 */
export async function checkMp4ForC2paHeader(
    src: string | Uint8Array | ArrayBuffer | Blob
): Promise<boolean> {

    // 1) Normalize input → Uint8Array (no MP4 parser; just raw bytes)
    let u8: Uint8Array;
    if (typeof src === "string") {
        const res = await fetch(src);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        u8 = new Uint8Array(await res.arrayBuffer());
    } else if (src instanceof Uint8Array) {
        u8 = src;
    } else if (src instanceof ArrayBuffer) {
        u8 = new Uint8Array(src);
    } else if (typeof Blob !== "undefined" && src instanceof Blob) {
        u8 = new Uint8Array(await src.arrayBuffer());
    } else {
        throw new TypeError("Unsupported input type");
    }

    // 2) Linear BMFF scan (no parser)
    // see https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html#_embedding_manifests_into_bmff_based_assets
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ext = [0xD8, 0xFE, 0xC3, 0xD6, 0x1B, 0x0E, 0x48, 0x3C, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7E, 0xC4, 0x81];
    const UUID = 0x75756964; // 'uuid' (big-endian)

    for (let off = 0, n = u8.byteLength; off + 8 <= n;) {
        const size = dv.getUint32(off, false); // BE
        const type = dv.getUint32(off + 4, false);

        // Compute box size and header length
        // Default BMFF header is 8 bytes (size+type)
        let header = 8;
        let boxSize = size;

        if (size === 1) {
            // largesize → header is 16 bytes
            if (off + 16 > n) break;
            const hi = dv.getUint32(off + 8, false);
            const lo = dv.getUint32(off + 12, false);
            boxSize = hi * 2 ** 32 + lo;
            header = 16;
            if (boxSize < 16) break;
        } else if (size === 0) {
            // size==0 → box extends to end of file
            boxSize = n - off;
        } else if (size < 8) {
            // invalid box
            break;
        }

        if (type === UUID) {
            // Extended Type starts immediately after actual header (8 or 16)
            const p = off + header;
            if (p + 16 <= n) {
                let i = 0;
                for (; i < 16 && u8[p + i] === ext[i]; i++) ;
                if (i === 16) return true; // found first C2PA uuid box → done
            }
        }

        const step = boxSize > 0 ? boxSize : 1;
        if (step <= 0) break;
        off += step;
    }

    return false;
}
