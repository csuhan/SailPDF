Sail PDF 0.11.1 Beta fixes the macOS application signature in the original 0.11.0 download. That package could be reported as “damaged” after an internet download because its customized Electron bundle had not been re-signed.

### What changed

- Apply a complete ad-hoc signature to the app and its nested code, including the OCR helper and bundled local AI runtime.
- Verify strict application signatures and Apple Silicon compatibility inside both DMG and ZIP downloads before publishing.
- Keep existing document files, settings and recovery-data locations unchanged.

### Downloads

- **DMG:** the standard Mac installation image.
- **ZIP:** the same application in an archive.
- **SHA256SUMS.txt:** integrity checksums for the downloadable packages.

### Before installing

This is an **ad-hoc signed, non-notarized beta** for **Apple Silicon Macs**. The ad-hoc signature verifies bundle integrity but does not establish a verified developer identity. macOS Gatekeeper may require explicit approval in **System Settings → Privacy & Security** before the first launch. This release does not disable macOS security protections.

Keep backups and review saved results. Complex paragraph reflow, some fonts and flattened annotations have limitations. Visual signatures are not certificate-based digital signatures.

Standard PDF operations run locally. AI is optional; custom endpoints receive the document context needed for the task. Model weights are downloaded only when requested and are not included.

See the repository README and in-app help for privacy, licensing and known limits.

---

**中文说明：** 0.11.1 修复了原 0.11.0 安装包的应用签名错误。原包在通过互联网下载后，可能被 macOS 提示“已损坏”。新包为应用、OCR 工具和本地 AI 运行组件生成完整的临时签名，并在发布前验证 DMG、ZIP 内的签名与 Apple Silicon 兼容性。

当前仍为**采用临时签名、未经 Apple 公证的测试版**。临时签名用于校验包完整性，不代表开发者身份已验证；首次启动可能需要在**系统设置 → 隐私与安全性**中明确允许。本版本不会关闭 macOS 安全保护。请保留重要文档备份，并核对下载文件的 SHA-256 校验值。
