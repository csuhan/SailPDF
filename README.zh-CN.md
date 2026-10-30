[EN](README.md) | [**中文**](README.zh-CN.md)

<div align="center">
  <img src="docs/images/logo.png" width="104" alt="Sail PDF 标志">
  <h1>Sail PDF</h1>
  <p>专注于文档的 Mac PDF 工作空间。</p>
  <p>阅读、批注、编辑与页面整理，以及位于原文旁边的可选 AI 助手。</p>
  <p><a href="https://sailpdf.pages.dev/">项目主页</a> · <a href="https://github.com/csuhan/SailPDF/releases">下载测试版</a> · <a href="https://github.com/csuhan/SailPDF/issues">问题反馈</a></p>
  <p><a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-172c40" alt="Apache 2.0"></a> <img src="https://img.shields.io/badge/macOS-Apple%20Silicon-172c40" alt="macOS Apple Silicon"> <a href="https://github.com/csuhan/SailPDF/actions/workflows/ci.yml"><img src="https://github.com/csuhan/SailPDF/actions/workflows/ci.yml/badge.svg" alt="持续集成"></a></p>
</div>

![Sail PDF 工作空间](docs/images/workspace.png)

## 围绕文档组织工作

|                | 可以完成的工作                                                                           |
| -------------- | ---------------------------------------------------------------------------------------- |
| **舒适阅读**   | 多文档标签页、全文搜索、大纲与书签，以及原色、暖纸、护眼绿和深色阅读底色。               |
| **批注与审阅** | 添加便签、高亮、下划线、删除线、画笔和图形；管理标准 PDF 批注，包括删除已有标记。        |
| **常用编辑**   | 修改支持的文字与图片、添加内容、填写表单、放置图像签名，并撤销修改。                     |
| **页面与导出** | 重排、旋转、合并、拆分与提取页面；导出文字、图片和支持的文档格式；压缩、保护或涂黑 PDF。 |
| **文档助手**   | 带来源引用的问答、摘要，以及确认后应用的修改方案；可选本机模型或自己的兼容 AI 服务。     |
| **文件保护**   | 恢复草稿包含表单内容；保存前校验与外部修改检查帮助避免误覆盖文件。                       |

界面与原生菜单支持 **英文和简体中文**。默认英文，在 **Settings → Appearance & reading → Interface language** 中切换。文档、批注、表单和已有对话不会随界面语言改变；AI 回答语言单独配置。

## 下载

当前桌面测试版支持 **macOS Apple Silicon**。请从 [GitHub Releases](https://github.com/csuhan/SailPDF/releases) 获取 DMG 或 ZIP，以及对应校验值。

**当前测试版采用临时签名、未经 Apple 公证**。临时签名用于校验包完整性，不代表开发者身份已验证。首次启动可能需要在**系统设置 → 隐私与安全性**中明确允许。请保留重要文档的备份，并检查保存结果，尤其是复杂版式和字体。当前版本暂不提供 Windows、Linux 或 Intel Mac 安装包。

## 隐私与 AI

阅读、批注和常用文档操作在本机完成，无需注册应用账号。AI 是可选功能：

- **本机模型：** 内置 llama.cpp 运行引擎，只有主动选择下载后才获取模型权重，推理在 Mac 上进行。
- **自定义服务：** 任务所需的文档上下文会发送到你配置的接口，处理私密文档前请了解服务方的数据政策。
- **凭据与反馈：** 桌面 API Key 使用系统安全存储加密，网页版仅在当前会话内保留。反馈和诊断不会自动提交。

详见 [隐私说明](public/legal/PRIVACY.txt)、[测试版使用限制](public/legal/TERMS.txt) 与 [模型许可](public/legal/MODEL_NOTICES.txt)。本地解析并不代表外部接口后续也只在本机或局域网处理数据。

## 从源码运行

使用 **Node.js 24**（见 [.nvmrc](.nvmrc)）和 npm。仓库保留源码，生成资源、测试 PDF、本机二进制和模型权重不进入 Git。

```sh
git clone https://github.com/csuhan/SailPDF.git
cd SailPDF
npm ci
npm run dev
```

在浏览器打开终端显示的本机地址。Mac 上启动桌面界面：

```sh
npm run app
```

完整打包 Apple Silicon 应用（含 OCR 与推理引擎）需要安装 Xcode Command Line Tools，然后运行：

```sh
npm run app:dmg
```

构建会下载并校验官方 llama.cpp 运行引擎，编译 Swift OCR、生成图标、构建前端，并在 `release/` 中输出 DMG；不包含模型权重。详见 [开发说明](docs/guides/DEVELOPMENT.md) 和 [发布说明](docs/guides/RELEASING.md)。

## 测试

```sh
npm test                 # 代码、文件保护、安全与双语检查
npm run build            # 类型检查与生产构建
brew install qpdf        # macOS 测试夹具依赖
npm run test:fixtures    # 在本机生成合成测试 PDF
npm run test:e2e         # 完整回归测试，需要 Chrome
npm run test:native      # 真实 Electron 安全与语言集成测试
```

浏览器和字体测试面向安装 Chrome 及标准系统字体的 macOS。夹具使用合成内容；包含系统字体的测试 PDF 仅留在本地，不会进入生产安装包。默认测试不连接真实 AI 服务，也不下载模型权重。可选真实模型测试有独立前提。

## 目录结构

```text
src/          React 界面、文档状态、PDF 操作与 AI 客户端
electron/     桌面安全桥接、文件保护与本机模型运行
locales/      界面翻译
native/       macOS Vision OCR 源码
build/        可编辑的应用图标源文件
scripts/      资源生成、测试与打包支持
public/legal/ 隐私、使用与模型说明
docs/         Cloudflare Pages 主页、图片与贡献者文档
```

## 已知限制

复杂段落重排、部分字体编码与已压平批注存在编辑限制。图像签名不是基于证书的数字签名。AI 可能出错，请核对引用和修改建议。恢复草稿用于降低损失风险，不能代替正式保存和独立备份。

## 参与改进

欢迎问题反馈、小型修复和功能改进。请先阅读 [贡献指南](CONTRIBUTING.md)，使用合成或脱敏的复现材料，避免在公开 Issue 中分享私密 PDF 或密钥。安全问题请按照 [SECURITY.md](SECURITY.md) 的方式报告。

## 许可

自有代码采用 **[Apache License 2.0](LICENSE)**，归属声明见 [NOTICE](NOTICE)。第三方软件、字体和模型保留各自许可；构建时会从安装依赖生成并随应用附上相应声明。
