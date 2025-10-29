import {build} from "esbuild";
import {copyFileSync, mkdirSync} from "node:fs";
import wasmUrlLiteralPlugin from "./utils/wasm-url-literal.plugin.mjs";

// build library
await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    outdir: "dist",
    sourcemap: true,
    assetNames: "assets/[name]-[hash]",
    plugins: [wasmUrlLiteralPlugin({
        outDir: "dist",
        outSub: "resources"
    })],
});

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
