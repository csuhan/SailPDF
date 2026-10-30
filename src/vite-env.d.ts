/// <reference types="vite/client" />

// pako ships with pdf-lib (no bundled types); only these are used
declare module 'pako' {
  const pako: { deflateRaw: (data: Uint8Array) => Uint8Array; deflate: (data: Uint8Array) => Uint8Array }
  export default pako
}
