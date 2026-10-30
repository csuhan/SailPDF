/** Sail PDF's open-sail mark, shared by the app and website. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="15 15 70 70" fill="currentColor" aria-hidden="true">
      <path d="M53 18C53 37 63 53 80 68H53Z" />
      <path d="M44 35 21 74H44Z" />
    </svg>
  )
}
