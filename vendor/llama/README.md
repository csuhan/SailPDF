# Bundled inference runtime

`npm run app:prepare` downloads the pinned official llama.cpp runtime using `scripts/fetch-llama.mjs`, verifies its SHA-256 and collects the server's library dependencies. Executables and model weights are not committed.

The upstream MIT license is retained here and included in packaged notices. Model weights are downloaded separately by the user, with their own licenses and checksums.
