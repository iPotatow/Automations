# Collection and translation scripts

See the repository README for configuration and the main-branch data contract.

run.mjs performs full/incremental collection or translation-only work. state.mjs saves checkpoints and exports SHA-256 publication manifests to main. translate.mjs calls Cloudflare Workers AI directly from Actions or the configured external provider. cloudflare-usage.mjs preserves the daily quota guard. sync.mjs publishes the fixed main commit through the protected Sites API. crawl.mjs remains available for diagnostic probes.

Run node --test *.test.mjs for regression checks. No website, database deployment or translation proxy is hosted by this repository.
