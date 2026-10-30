/** Stable page identities and their properties, replayed in edit order. */
import type { EditOp } from './ops'

/** positive: original page number; negative: inserted blank page identity */
export type PageMap = number[]

export interface PageState {
  map: PageMap
  rotations: Map<number, number>
  blankSizes: Map<number, { width: number; height: number }>
}

/** Resolve positional commands when they occur, before later reordering. */
export function computePageState(numOriginalPages: number, ops: EditOp[]): PageState {
  let map = Array.from({ length: numOriginalPages }, (_, i) => i + 1)
  const rotations = new Map<number, number>()
  const blankSizes = new Map<number, { width: number; height: number }>()
  let blankSeq = -1
  for (const op of ops) {
    switch (op.kind) {
      case 'page-delete':
        if (op.pageIndex >= 0 && op.pageIndex < map.length) map.splice(op.pageIndex, 1)
        break
      case 'page-reorder':
        map = op.order.slice()
        break
      case 'page-insert-blank': {
        const ref = blankSeq--
        blankSizes.set(ref, { width: op.width, height: op.height })
        map.splice(op.pageIndex, 0, ref)
        break
      }
      case 'page-rotate': {
        const ref = map[op.pageIndex]
        if (ref !== undefined) rotations.set(ref, ((rotations.get(ref) ?? 0) + op.degrees + 360) % 360)
        break
      }
    }
  }
  return { map, rotations, blankSizes }
}

export function computePageMap(numOriginalPages: number, ops: EditOp[]): PageMap {
  return computePageState(numOriginalPages, ops).map
}

/** Extra rotation of the page currently at a one-based view position. */
export function pageExtraRotation(viewPage: number, ops: EditOp[], numOriginalPages: number): number {
  const state = computePageState(numOriginalPages, ops)
  return state.rotations.get(state.map[viewPage - 1]) ?? 0
}
