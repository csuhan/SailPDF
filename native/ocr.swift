// Sail PDF OCR helper: recognises text in images with Apple's Vision framework
// (on-device). Usage: pdfpro-ocr <image> [<image> ...]
// Prints one JSON object per image: {"w":..,"h":..,"lines":[{"text":..,"conf":..,"box":[x,y,w,h]}]}
// box is normalised (0..1), origin top-left.
import Foundation
import Vision
import AppKit

func recognize(_ path: String) -> [String: Any] {
  guard let img = NSImage(contentsOfFile: path),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    return ["error": "cannot read image"]
  }
  var lines: [[String: Any]] = []
  let req = VNRecognizeTextRequest { r, _ in
    for obs in (r.results as? [VNRecognizedTextObservation]) ?? [] {
      guard let top = obs.topCandidates(1).first else { continue }
      let b = obs.boundingBox
      // per-character boxes are not reliable for CJK: keep line boxes
      lines.append(["text": top.string, "conf": top.confidence,
                    "box": [b.minX, 1 - b.maxY, b.width, b.height]])
    }
  }
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = true
  if #available(macOS 13.0, *) { req.automaticallyDetectsLanguage = true }
  req.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US", "ja-JP"]
  do { try VNImageRequestHandler(cgImage: cg).perform([req]) } catch { return ["error": "\(error)"] }
  return ["w": cg.width, "h": cg.height, "lines": lines]
}

for p in CommandLine.arguments.dropFirst() {
  let r = recognize(p)
  if let d = try? JSONSerialization.data(withJSONObject: r), let s = String(data: d, encoding: .utf8) { print(s) }
}
