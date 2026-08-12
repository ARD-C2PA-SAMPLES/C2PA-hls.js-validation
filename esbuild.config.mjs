import {build} from "esbuild";
import {copyFileSync} from "node:fs";
import wasmUrlLiteralPlugin from "./utils/wasm-url-literal.plugin.mjs";

// The two C2PA engines. Externalized in the "chunked" build so a downstream
// bundler resolves and code-splits them (webpack honours the webpackChunkName
// magic comments in createEngine.ts). Exact specifiers only — a "/*" wildcard
// would also externalize the .wasm subpath and defeat the wasm-url-literal plugin.
const ENGINES = ["@contentauth/c2pa-web", "@nettrek/c2pa-web-crypto"];

/** @type {import("esbuild").BuildOptions} */
const base = {
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    sourcemap: true,
    assetNames: "assets/[name]-[hash]",
    plugins: [wasmUrlLiteralPlugin({
        outDir: "dist",
        outSub: "resources"
    })],
};

// Default `.` export: engines inlined, self-contained. Usable without a bundler
// (e.g. the demo loads dist/index.js directly via <script type=module>).
await build({...base, outfile: "dist/index.js"});

// `./chunked` export: engines externalized so the consuming bundler emits them
// as separate chunks. Identical public API/types as the default entry.
await build({...base, outfile: "dist/chunked.js", external: ENGINES});

// build common helpers separately
await build({
    entryPoints: ["src/helpers/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    outdir: "dist/helpers",
    sourcemap: true,
    assetNames: "assets/[name]-[hash]",
});

copyFileSync("demo/index.html", "dist/index.html");

console.log("✓ Build done. Open demo via: npm run preview");
