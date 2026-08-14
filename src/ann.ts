// 批注插件核心类型与工具函数
import type { Block, ContentFragment, CursorNodeData, DbId } from "./orca.d.ts"

/** 批注 fragment 的类型标识 */
export const ANN_TYPE = "pizhu.ann"

/** 批注 fragment 结构：t=v 存原文文本，note 存批注内容，texts 存原文 fragments 快照（删除时还原） */
export interface AnnFragment extends ContentFragment {
  t: typeof ANN_TYPE
  v: string
  id: string
  note: string
  texts: ContentFragment[]
  created: number
  modified?: number
}

export function isAnn(f: ContentFragment | undefined | null): f is AnnFragment {
  return f != null && f.t === ANN_TYPE
}

/** 生成批注唯一 id */
export function genAnnId(): string {
  return `ann_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 文本值统一取 string */
function textOf(f: ContentFragment | undefined): string {
  return f == null ? "" : String(f.v ?? "")
}

/**
 * 提取 content 中 [start, end]（同一块内，index/offset 定位）覆盖的原文 fragments 与纯文本。
 */
export function extractRange(
  content: ContentFragment[],
  start: CursorNodeData,
  end: CursorNodeData,
): { fragments: ContentFragment[]; text: string } {
  const fragments: ContentFragment[] = []
  let text = ""
  const len = content.length
  const si = Math.max(0, Math.min(start.index, len - 1))
  const ei = Math.max(0, Math.min(end.index, len - 1))
  if (si > ei) return { fragments, text }

  for (let i = si; i <= ei; i++) {
    const f = content[i]
    const v = textOf(f)
    let clipped: string
    if (i === si && i === ei) {
      clipped = v.slice(start.offset, end.offset)
    } else if (i === si) {
      clipped = v.slice(start.offset)
    } else if (i === ei) {
      clipped = v.slice(0, end.offset)
    } else {
      clipped = v
    }
    if (!clipped) continue
    fragments.push({ ...f, v: clipped })
    text += clipped
  }
  return { fragments, text }
}

/**
 * 将 content 中 [start, end] 范围替换为一个批注 fragment。
 * 选中范围两端若落在 fragment 内部，会保留其前缀/后缀为独立 fragment。
 */
export function replaceRange(
  content: ContentFragment[],
  start: CursorNodeData,
  end: CursorNodeData,
  ann: AnnFragment,
): ContentFragment[] {
  const len = content.length
  const si = Math.max(0, Math.min(start.index, len - 1))
  const ei = Math.max(0, Math.min(end.index, len - 1))
  const newContent: ContentFragment[] = []

  for (let i = 0; i < len; i++) {
    if (i < si || i > ei) {
      newContent.push(content[i])
      continue
    }
    if (i === si) {
      const f = content[i]
      const v = textOf(f)
      const prefix = v.slice(0, start.offset)
      if (prefix) newContent.push({ ...f, v: prefix })
      newContent.push(ann)
      if (si === ei) {
        const suffix = v.slice(end.offset)
        if (suffix) newContent.push({ ...f, v: suffix })
      }
    } else if (i === ei) {
      const f = content[i]
      const v = textOf(f)
      const suffix = v.slice(end.offset)
      if (suffix) newContent.push({ ...f, v: suffix })
    }
    // si < i < ei 的 fragment 已并入 ann.texts，直接跳过
  }
  return newContent
}

/**
 * 更新某块 content 中指定 id 的批注 fragment。
 */
export function updateAnn(
  content: ContentFragment[],
  annId: string,
  patch: Partial<Pick<AnnFragment, "note" | "modified" | "v">>,
): ContentFragment[] {
  return content.map((f) => {
    if (!isAnn(f) || f.id !== annId) return f
    return { ...f, ...patch }
  })
}

/**
 * 删除某块 content 中指定 id 的批注，还原为原文 fragments。
 */
export function removeAnn(
  content: ContentFragment[],
  annId: string,
): ContentFragment[] {
  const result: ContentFragment[] = []
  for (const f of content) {
    if (isAnn(f) && f.id === annId) {
      result.push(...(f.texts.length > 0 ? f.texts : [{ t: "t", v: f.v }]))
    } else {
      result.push(f)
    }
  }
  return result
}

/** 批注在块内的序号（从 1 开始，按 content 中出现的顺序） */
export function annOrdinal(content: ContentFragment[], upToIndex: number): number {
  let n = 0
  for (let i = 0; i <= upToIndex && i < content.length; i++) {
    if (isAnn(content[i])) n++
  }
  return n
}

/** 递归收集一棵块树内所有批注，附带所属块信息 */
export interface AnnEntry {
  ann: AnnFragment
  block: Block
  ordinal: number // 块内序号
}

export function collectAnnotations(rootBlockId: DbId): AnnEntry[] {
  const entries: AnnEntry[] = []
  const visit = (id: DbId | undefined) => {
    if (id == null) return
    const block = orca.state.blocks[id]
    if (block == null) return
    const content = block.content ?? []
    let ord = 0
    content.forEach((f, i) => {
      if (isAnn(f)) {
        ord++
        entries.push({ ann: f, block, ordinal: ord })
      }
    })
    ;(block.children ?? []).forEach((cid) => visit(cid))
  }
  visit(rootBlockId)
  return entries
}

/**
 * 在面板树（RowPanel/ColumnPanel/ViewPanel）中查找指定 id 的 ViewPanel。
 */
export function findViewPanel(
  panelId: string,
  root: any,
): any | null {
  if (root == null) return null
  if (root.id === panelId) return root
  if (root.children == null) return null
  for (const child of root.children) {
    const found = findViewPanel(panelId, child)
    if (found) return found
  }
  return null
}

/**
 * 在面板树中按 view 类型查找已打开的面板（用于复用）。
 */
export function findViewPanelByView(
  view: string,
  root: any,
): any | null {
  if (root == null) return null
  if (root.view === view) return root
  if (root.children == null) return null
  for (const child of root.children) {
    const found = findViewPanelByView(view, child)
    if (found) return found
  }
  return null
}

/** 取当前活跃面板的根块 id（block 视图） */
export function getActiveRootBlockId(): DbId | undefined {
  const panel = findViewPanel(orca.state.activePanel, orca.state.panels)
  if (panel == null) return undefined
  if (panel.view === "block") {
    return (panel.viewArgs?.blockId as DbId) ?? (panel.viewState?.rootBlockId as DbId)
  }
  return (panel.viewState?.rootBlockId as DbId) ?? (panel.viewArgs?.rootBlockId as DbId)
}
