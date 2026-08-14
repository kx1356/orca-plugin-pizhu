// 批注卡浮层与交互的全局状态（基于虎鲸注入的 Valtio，不依赖本地依赖包）
import type { DbId } from "./orca.d.ts"

const { proxy } = window.Valtio as any

export interface AnnCardState {
  visible: boolean
  blockId: DbId | null
  annId: string
  x: number
  y: number
}

export const annCard: AnnCardState = proxy({
  visible: false,
  blockId: null,
  annId: "",
  x: 0,
  y: 0,
})

export function openAnnCard(blockId: DbId, annId: string, x: number, y: number) {
  annCard.visible = true
  annCard.blockId = blockId
  annCard.annId = annId
  annCard.x = x
  annCard.y = y
}

export function closeAnnCard() {
  annCard.visible = false
}
