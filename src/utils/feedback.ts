import { tr } from '../i18n/locale'
import { getDesktop } from '../desktop/bridge'
/** An explicit allowlist: never collect stores, paths, documents or credentials. */
export function diagnosticInfo() {
  const desktop = getDesktop()
  return {
    product: 'Sail PDF',
    version: import.meta.env.VITE_APP_VERSION ?? 'development',
    platform: navigator.platform,
    language: navigator.language,
    environment: desktop ? 'desktop' : 'web',
    features: {
      localModels: !!desktop?.localAI,
      ocrInterface: !!desktop?.ocr,
      protectedCredentialStore: !!desktop?.secrets,
    },
  }
}
export function redactFeedback(text: string): string {
  return text
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, tr('[已隐藏的密钥]'))
    .replace(/Bearer\s+[^\s"']+/gi, tr('Bearer [已隐藏]'))
    .replace(/(?:\/Users\/|\/home\/)[^\s"'<>]+|[A-Z]:\\[^\r\n"'<>]+/gi, tr('[已隐藏的本机路径]'))
}
export function feedbackReport(description: string): string {
  return tr(
    'Sail PDF 问题反馈\n\n请在分享前再次核对，勿附加私密文档或密钥。\n\n问题描述与复现步骤\n{0}\n\n环境诊断（仅包含以下字段）\n{1}\n',
    redactFeedback(description.trim() || tr('（请补充问题描述、复现步骤、实际和预期结果）')),
    JSON.stringify(diagnosticInfo(), null, 2),
  )
}
