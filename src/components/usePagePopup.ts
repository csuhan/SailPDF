import { useLayoutEffect, useRef, useState } from 'react'

/** Keep page popovers inside the visible reader, independent of page zoom. */
export function usePagePopup(anchor: () => HTMLElement | null, key: string) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 280, maxHeight: 400 })
  useLayoutEffect(() => {
    const update = () => {
      const element = anchor(),
        popup = ref.current
      if (!element || !popup) return
      const a = element.getBoundingClientRect()
      const reader = document.querySelector('.viewport-area')?.getBoundingClientRect()
      const left = Math.max(8, reader?.left ?? 8),
        right = Math.min(innerWidth - 8, reader?.right ?? innerWidth - 8)
      const top = Math.max(8, reader?.top ?? 8),
        bottom = Math.min(innerHeight - 8, reader?.bottom ?? innerHeight - 8)
      const maxWidth = Math.max(120, right - left - 16),
        maxHeight = Math.max(100, bottom - top - 16)
      const w = Math.min(popup.offsetWidth, maxWidth),
        h = Math.min(popup.offsetHeight, maxHeight)
      const preferred = a.right + 8 + w <= right ? a.right + 8 : a.left - w - 8
      setPosition({
        left: Math.max(left + 8, Math.min(preferred, right - w - 8)),
        top: Math.max(top + 8, Math.min(a.top, bottom - h - 8)),
        maxWidth,
        maxHeight,
      })
    }
    update()
    const observer = new ResizeObserver(update)
    if (ref.current) observer.observe(ref.current)
    window.addEventListener('resize', update)
    document.addEventListener('scroll', update, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      document.removeEventListener('scroll', update, true)
    }
  }, [key])
  return { ref, style: { ...position, position: 'fixed' as const } }
}
