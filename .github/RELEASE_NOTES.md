Sail PDF 0.11.2 Beta adds a clearer Mac installation flow, with crisp Retina artwork and English/Chinese first-launch instructions visible before you open the app.

### What changed

- Render the DMG artwork separately at 1× and 2× resolution for Retina displays.
- Keep the app and Applications icons as native draggable Finder items, with all installation steps visible in one window without scrolling.
- Include a bilingual `INSTALL.txt` in the DMG and add the same first-launch guidance to the website download dialog.
- Retain the complete ad-hoc signatures and strict app, OCR and local AI component checks introduced in 0.11.1.

### Downloads

- **DMG:** the recommended Mac installation image, with the guided installation window.
- **ZIP:** the same application in an archive.
- **INSTALL.txt:** standalone English/Chinese installation and first-launch instructions, also included in the DMG.
- **SHA256SUMS.txt:** integrity checksums for the downloadable files.
- **VERIFICATION.txt:** validation results for this release.

### Before installing

This is an **ad-hoc signed, non-notarized beta** for **Apple Silicon Macs**. The ad-hoc signature verifies bundle integrity but does not establish a verified developer identity. macOS Gatekeeper may require explicit approval in **System Settings → Privacy & Security → Open Anyway** before the first launch.

The instructions do not run commands automatically or change macOS security settings. If you use the advanced Terminal option in `INSTALL.txt`, first confirm that you downloaded the package from this official repository.

Keep backups and review saved results. Complex paragraph reflow, some fonts and flattened annotations have limitations. Visual signatures are not certificate-based digital signatures.

Standard PDF operations run locally. AI is optional; custom endpoints receive the document context needed for the task. Model weights are downloaded only when requested and are not included.

See the repository README and in-app help for privacy, licensing and known limits.

---

**中文说明：** 0.11.2 为 Mac 安装窗口加入分别渲染的 1×/2× Retina 高清背景。应用与“应用程序”图标仍为原生可拖拽项目，中英文安装步骤和首次启动说明可在一个窗口内完整看到，无需滚动。DMG 内附有双语 `INSTALL.txt`，官网下载弹窗也展示相同步骤。

本版本保留 0.11.1 的完整临时签名及安装包校验，仍为**未经 Apple 公证的 Apple Silicon 测试版**。临时签名用于校验包完整性，不代表开发者身份已验证；首次启动可能需要在**系统设置 → 隐私与安全性**中点击“仍要打开”，再按系统提示确认。

安装说明不会自动执行命令或修改 macOS 安全设置。若使用 `INSTALL.txt` 中的进阶终端方式，请先确认安装包来自本官方仓库。请保留重要文档备份，并核对下载文件的 SHA-256 校验值。
