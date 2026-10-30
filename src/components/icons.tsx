import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }

function svg(props: P, children: React.ReactNode) {
  const { size = 18, ...rest } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconSidebar = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9.5" y1="4" x2="9.5" y2="20" />
    </>,
  )

export const IconOpen = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </>,
  )

export const IconSave = (p: P) =>
  svg(
    p,
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8" />
      <path d="M7 3v5h8" />
    </>,
  )

export const IconUndo = (p: P) =>
  svg(
    p,
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>,
  )

export const IconRedo = (p: P) =>
  svg(
    p,
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>,
  )

export const IconPrevPage = (p: P) => svg(p, <path d="m18 15-6-6-6 6" />)
export const IconNextPage = (p: P) => svg(p, <path d="m6 9 6 6 6-6" />)

export const IconZoomOut = (p: P) =>
  svg(
    p,
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>,
  )

export const IconZoomIn = (p: P) =>
  svg(
    p,
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="8" y1="11" x2="14" y2="11" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>,
  )

export const IconFitWidth = (p: P) =>
  svg(
    p,
    <>
      <rect x="6" y="3" width="12" height="18" rx="1" />
      <path d="M2 8v8M22 8v8" />
      <path d="M2 12h4M18 12h4" />
    </>,
  )

export const IconFitPage = (p: P) =>
  svg(
    p,
    <>
      <rect x="2" y="2" width="20" height="20" rx="2" />
      <rect x="7" y="5" width="10" height="14" rx="1" />
    </>,
  )

export const IconContinuous = (p: P) =>
  svg(
    p,
    <>
      <rect x="4" y="2" width="16" height="7" rx="1" />
      <rect x="4" y="12" width="16" height="7" rx="1" />
    </>,
  )

export const IconSinglePage = (p: P) =>
  svg(
    p,
    <>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M9 7h6M9 11h6M9 15h4" />
    </>,
  )

export const IconRotateCW = (p: P) =>
  svg(
    p,
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </>,
  )

export const IconRotateCCW = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
    </>,
  )

export const IconSearch = (p: P) =>
  svg(
    p,
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>,
  )

export const IconClose = (p: P) => svg(p, <path d="M6 6l12 12M18 6 6 18" />)

export const IconEdit = (p: P) =>
  svg(
    p,
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>,
  )

export const IconOrganize = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="3" width="7" height="10" rx="1" />
      <rect x="14" y="3" width="7" height="10" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <rect x="14" y="16" width="7" height="5" rx="1" />
    </>,
  )

export const IconText = (p: P) =>
  svg(
    p,
    <>
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </>,
  )

export const IconImage = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="m21 15-5-5-9 9" />
    </>,
  )

export const IconDraw = (p: P) =>
  svg(
    p,
    <>
      <path d="m12 19 7-7a2.1 2.1 0 0 0-3-3l-7 7-2 5z" />
      <path d="m14 9 3 3" />
    </>,
  )

export const IconHighlight = (p: P) =>
  svg(
    p,
    <>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.5 4.5L13 12l4.5-4.5z" />
    </>,
  )

export const IconSelect = (p: P) =>
  svg(
    p,
    <>
      <path d="m4 2 7 19 2.5-8.5L22 8z" />
    </>,
  )

export const IconChevronDown = (p: P) => svg(p, <path d="m6 9 6 6 6-6" />)

export const IconPrint = (p: P) =>
  svg(
    p,
    <>
      <path d="M6 9V2h12v7" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </>,
  )

export const IconTrash = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>,
  )

export const IconDownload = (p: P) =>
  svg(
    p,
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>,
  )

export const IconImageReplace = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </>,
  )

export const IconRestore = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </>,
  )

export const IconBook = (p: P) =>
  svg(
    p,
    <>
      <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" />
      <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
    </>,
  )

export const IconPenLine = (p: P) =>
  svg(
    p,
    <>
      <path d="M12 20h9" />
      <path d="M16.4 3.6a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>,
  )

export const IconMarker = (p: P) =>
  svg(
    p,
    <>
      <path d="m9 11-6 6v3h9l3-3" />
      <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
    </>,
  )

export const IconPages = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>,
  )

export const IconUnderline = (p: P) =>
  svg(
    p,
    <>
      <path d="M6 4v6a6 6 0 0 0 12 0V4" />
      <path d="M4 20h16" />
    </>,
  )

export const IconStrike = (p: P) =>
  svg(
    p,
    <>
      <path d="M16 4H9a3 3 0 0 0-2.8 4" />
      <path d="M14 12a4 4 0 0 1 0 8H6" />
      <path d="M4 12h16" />
    </>,
  )

export const IconShapes = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="11" width="10" height="10" rx="1" />
      <circle cx="16" cy="8" r="5" />
    </>,
  )

export const IconRedact = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="6" y="9" width="12" height="6" fill="currentColor" stroke="none" />
    </>,
  )

export const IconSquare = (p: P) => svg(p, <rect x="4" y="5" width="16" height="14" rx="1" />)
export const IconCircle = (p: P) => svg(p, <ellipse cx="12" cy="12" rx="9" ry="7.5" />)
export const IconLine = (p: P) => svg(p, <path d="M5 19 19 5" />)
export const IconArrow = (p: P) =>
  svg(
    p,
    <>
      <path d="M5 19 19 5" />
      <path d="M10 5h9v9" />
    </>,
  )

export const IconMinus = (p: P) => svg(p, <path d="M5 12h14" />)
export const IconPlus = (p: P) => svg(p, <path d="M12 5v14M5 12h14" />)
export const IconCheck = (p: P) => svg(p, <path d="m5 12 5 5L20 7" />)

export const IconArrowLeft = (p: P) =>
  svg(
    p,
    <>
      <path d="M19 12H5" />
      <path d="m12 19-7-7 7-7" />
    </>,
  )

export const IconArrowRight = (p: P) =>
  svg(
    p,
    <>
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </>,
  )

export const IconFilePlus = (p: P) =>
  svg(
    p,
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M12 12v6M9 15h6" />
    </>,
  )

export const IconFiles = (p: P) =>
  svg(
    p,
    <>
      <path d="M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M15 2v5h5" />
      <path d="M4 7v13a2 2 0 0 0 2 2h10" />
    </>,
  )

export const IconScissors = (p: P) =>
  svg(
    p,
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </>,
  )

export const IconFileText = (p: P) =>
  svg(
    p,
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </>,
  )

export const IconList = (p: P) =>
  svg(
    p,
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </>,
  )

export const IconGrid = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>,
  )

export const IconSliders = (p: P) =>
  svg(
    p,
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <path d="M1 14h6M9 8h6M17 16h6" />
    </>,
  )

export const IconHome = (p: P) =>
  svg(
    p,
    <>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9v11h14V9" />
      <path d="M10 20v-6h4v6" />
    </>,
  )

export const IconNote = (p: P) =>
  svg(
    p,
    <>
      <path d="M4 4h16v12H9l-5 4z" />
      <path d="M8 8.5h8M8 12h5" />
    </>,
  )

export const IconTools = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M17.5 14v7M14 17.5h7" />
    </>,
  )

export const IconStamp = (p: P) =>
  svg(
    p,
    <>
      <path d="M5 21h14" />
      <path d="M6 17h12v-3a2 2 0 0 0-2-2h-2l-.5-3.5a2.5 2.5 0 1 0-3 0L10 12H8a2 2 0 0 0-2 2z" />
    </>,
  )

export const IconHash = (p: P) =>
  svg(
    p,
    <>
      <path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16" />
    </>,
  )

export const IconInfo = (p: P) =>
  svg(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>,
  )

export const IconFileExport = (p: P) =>
  svg(
    p,
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7" />
      <path d="M14 3v6h6v3" />
      <path d="M16 19h6M19 16l3 3-3 3" />
    </>,
  )

export const IconCompress = (p: P) =>
  svg(
    p,
    <>
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </>,
  )

export const IconSignature = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 17c3 0 4-8 6-8s0 8 3 8 3-4 5-4 2 2 4 2" />
      <path d="M3 21h18" />
    </>,
  )

export const IconForm = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <rect x="6" y="8" width="12" height="3" rx="0.5" />
      <path d="M6 15h5M14 15h4" />
    </>,
  )

// lucide: lock
export const IconLock = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>,
  )

// lucide: lock-open
export const IconLockOpen = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </>,
  )

// lucide: shield-check
export const IconShield = (p: P) =>
  svg(
    p,
    <>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </>,
  )

// lucide: stamp
export const IconStampTool = (p: P) =>
  svg(
    p,
    <>
      <path d="M5 22h14" />
      <path d="M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z" />
      <path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13" />
    </>,
  )

// lucide: git-compare
export const IconCompare = (p: P) =>
  svg(
    p,
    <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M11 18H8a2 2 0 0 1-2-2V9" />
    </>,
  )

// lucide: ruler
export const IconRuler = (p: P) =>
  svg(
    p,
    <>
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2" />
      <path d="m11.5 9.5 2-2" />
      <path d="m8.5 6.5 2-2" />
      <path d="m17.5 15.5 2-2" />
    </>,
  )

// lucide: eraser
export const IconEraser = (p: P) =>
  svg(
    p,
    <>
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </>,
  )

// lucide: square-dashed-mouse-pointer (used for "redact selection")
export const IconBan = (p: P) =>
  svg(
    p,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m4.9 4.9 14.2 14.2" />
    </>,
  )

// lucide: file-image (create pdf from images)
export const IconFileImage = (p: P) =>
  svg(
    p,
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <circle cx="10" cy="12" r="2" />
      <path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />
    </>,
  )

// lucide: paperclip
export const IconPaperclip = (p: P) =>
  svg(
    p,
    <>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </>,
  )

// lucide: file-scan (OCR)
export const IconScanText = (p: P) =>
  svg(
    p,
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <path d="M7 8h8M7 12h10M7 16h6" />
    </>,
  )

// lucide: crop
export const IconCrop = (p: P) =>
  svg(
    p,
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>,
  )

// lucide: brush-cleaning / sparkles (sanitize)
export const IconSparkles = (p: P) =>
  svg(
    p,
    <>
      <path d="M9.94 14.06 4 20M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z" />
      <path d="M20 16v4M18 18h4" />
    </>,
  )

// lucide: sparkles (AI)
export const IconAI = (p: P) =>
  svg(
    p,
    <>
      <path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z" />
      <path d="M20 3v4M22 5h-4" />
    </>,
  )

// lucide: send
export const IconSend = (p: P) =>
  svg(
    p,
    <>
      <path d="M14.54 21.69a.5.5 0 0 0 .93-.02l6.5-19a.5.5 0 0 0-.64-.64l-19 6.5a.5.5 0 0 0-.02.93l7.93 3.18a2 2 0 0 1 1.11 1.11z" />
      <path d="m21.85 2.15-10.94 10.93" />
    </>,
  )

// lucide: square (stop)
export const IconStop = (p: P) =>
  svg(
    p,
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </>,
  )

// lucide: settings-2
export const IconSettings = (p: P) =>
  svg(
    p,
    <>
      <path d="M20 7h-9M14 17H5" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </>,
  )

// lucide: monitor-smartphone -> "local"
export const IconLaptop = (p: P) =>
  svg(
    p,
    <>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M2 20h20" />
    </>,
  )

// lucide: cloud
export const IconCloud = (p: P) =>
  svg(
    p,
    <>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </>,
  )

// lucide: rotate-ccw-square? -> eraser of chat: message-square-x
export const IconBroom = (p: P) =>
  svg(
    p,
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="m14.5 7.5-5 5M9.5 7.5l5 5" />
    </>,
  )

// lucide: book-open (two-page spread)
export const IconSpread = (p: P) =>
  svg(
    p,
    <>
      <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2z" />
      <path d="M22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" />
    </>,
  )

// lucide: moon
export const IconMoon = (p: P) =>
  svg(
    p,
    <>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </>,
  )

// lucide: maximize
export const IconMaximize = (p: P) =>
  svg(
    p,
    <>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </>,
  )

// lucide: bookmark
export const IconBookmark = (p: P) =>
  svg(
    p,
    <>
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </>,
  )

// lucide: star
export const IconStar = (p: P) =>
  svg(
    p,
    <>
      <path d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2 2 0 0 0 1.5 1.1l5.2.8a.5.5 0 0 1 .3.9l-3.8 3.6a2 2 0 0 0-.6 1.8l.9 5.2a.5.5 0 0 1-.8.6l-4.6-2.5a2 2 0 0 0-1.9 0L5.4 21a.5.5 0 0 1-.8-.6l.9-5.2a2 2 0 0 0-.6-1.8L1.2 9.8a.5.5 0 0 1 .3-.9l5.2-.8a2 2 0 0 0 1.5-1.1z" />
    </>,
  )

// lucide: pin
export const IconPin = (p: P) =>
  svg(
    p,
    <>
      <path d="M12 17v5" />
      <path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </>,
  )

// lucide: message-square-text (annotation list)
export const IconComments = (p: P) =>
  svg(
    p,
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M7 8h10M7 12h6" />
    </>,
  )

// lucide: file-type (convert)
export const IconConvert = (p: P) =>
  svg(
    p,
    <>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M9 13h6M9 17h3" />
    </>,
  )

// lucide: share
export const IconShare = (p: P) =>
  svg(
    p,
    <>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="m16 6-4-4-4 4M12 2v13" />
    </>,
  )

// lucide: link
export const IconLink = (p: P) =>
  svg(
    p,
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>,
  )

// lucide: upload / import
export const IconImport = (p: P) =>
  svg(
    p,
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5M12 15V3" />
    </>,
  )
