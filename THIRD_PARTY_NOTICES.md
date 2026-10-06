# Local background removal components

The app runs U2NetP inference inside a browser Web Worker. Runtime files and
model weights are hosted with the app; user photos are never sent to an AI
service. No API key or cloud background-removal service is used.

- **U2NetP / U²-Net** by Xuebin Qin and the U²-Net authors.
  [Original source](https://github.com/xuebinqin/U-2-Net), Apache License 2.0;
  the full license is in `assets/ai/LICENSE-U2NET.txt`.
  ONNX weights are the unmodified
  [rembg U2NetP release](https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx),
  verified against upstream MD5 `8e83ca70e441ab06c318d82300c84806`.
  The bundled bytes were acquired through the immutable
  [edgetools mirror](https://huggingface.co/edgetools/u2netp/resolve/25dee37ab19c5b6ad64ba6578eba63f1ae07720c/u2netp.onnx)
  and verified byte-for-byte using that MD5 and SHA-256
  `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`.
  [Upstream preprocessing and prediction](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py)
  use 320 × 320 RGB, maximum-pixel normalization, ImageNet mean/std, NCHW float32,
  the first output, and min/max mask normalization.
- **ONNX Runtime Web 1.23.2**, Microsoft Corporation, MIT License.
  [Source and release](https://github.com/microsoft/onnxruntime/tree/v1.23.2).
  The full license and upstream third-party notices are in
  `assets/vendor/onnxruntime/LICENSE.txt` and `ThirdPartyNotices.txt`.
  The WASM bundle runs with one thread so GitHub Pages does not need special
  cross-origin isolation headers. Computation occurs in a module Web Worker.

`node scripts/vendor-ai.mjs` reproduces the vendored files from the pinned npm
runtime package and upstream weights. File sizes and SHA-256 checksums are in
`assets/ai/manifest.json`.
