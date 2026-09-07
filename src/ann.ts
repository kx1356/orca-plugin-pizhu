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
  /** 创建时从 DOM 捕获的原文样式快照（字号/颜色等），渲染时还原，避免批注后文本变默认样式 */
  domStyle?: Record<string, string>
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

/** 递归收集一棵块树内所有批注，附带所属块信息 */
export interface AnnEntry {
  ann: AnnFragment
  block: Block
  ordinal: number // 整篇文档内序号（DFS 先序，从 1 递增）
}

export function collectAnnotations(rootBlockId: DbId): AnnEntry[] {
  const entries: AnnEntry[] = []
  const seen = new Set<DbId>()
  const MAX_DEPTH = 1000 // 防御异常数据（成环/超深）导致死循环
  // 全局累计：DFS 先序 = 文档阅读顺序，让序号在整篇文档内递增（1、2、3…），
  // 与正文角标（annGlobalOrdinal）语义一致
  let ord = 0
  const visit = (id: DbId | undefined, depth: number) => {
    if (id == null || depth > MAX_DEPTH || seen.has(id)) return
    seen.add(id)
    const block = orca.state.blocks[id]
    if (block == null) return
    const content = block.content ?? []
    content.forEach((f, i) => {
      if (isAnn(f)) {
        ord++
        entries.push({ ann: f, block, ordinal: ord })
      }
    })
    ;(block.children ?? []).forEach((cid) => visit(cid, depth + 1))
  }
  visit(rootBlockId, 0)
  return entries
}

/** 全库批注总数（轻量计数：只遍历块统计 pizhu.ann 数量，不回溯根、不构建分组）。
 *  用作顶栏徽标常驻数字，与 collectAllGroups 的结果求和一致（同一数据源）。 */
export function countAllAnnotations(blocks: any): number {
  let n = 0
  for (const id of Object.keys(blocks)) {
    const content = blocks[id]?.content
    if (!Array.isArray(content)) continue
    for (const f of content) {
      if (f != null && f.t === ANN_TYPE) n++
    }
  }
  return n
}

/** 从任意块 id 沿 parent 链回溯到根块（页面）id */
export function rootIdOf(blockId: DbId | string, blocks: any): DbId {
  const visited = new Set<DbId>()
  let cur = blocks[blockId]
  while (cur != null && cur.parent != null && cur.parent !== "" && !visited.has(cur.id)) {
    visited.add(cur.id)
    cur = blocks[cur.parent]
  }
  return cur?.id as DbId
}

/**
 * 计算某批注在整篇文档中的全局序号（DFS 先序，与 collectAnnotations 一致）。
 * 从 rootId 遍历，遇目标块 blockId 数到 upToIndex（含）为止后停止，不再下钻子块。
 * 供正文角标渲染在无共享计数状态时按需重算。
 */
export function annGlobalOrdinal(
  rootId: DbId,
  blockId: DbId,
  upToIndex: number,
): number {
  const seen = new Set<DbId>()
  const MAX_DEPTH = 1000
  let count = 0
  let hit = false
  const visit = (id: DbId | undefined, depth: number) => {
    if (hit || id == null || depth > MAX_DEPTH || seen.has(id)) return
    seen.add(id)
    const block = orca.state.blocks[id]
    if (block == null) return
    const content = block.content ?? []
    const limit =
      id === blockId
        ? Math.max(0, Math.min(upToIndex, content.length - 1))
        : content.length - 1
    for (let i = 0; i <= limit; i++) {
      if (isAnn(content[i])) count++
    }
    if (id === blockId) {
      hit = true
      return
    }
    ;(block.children ?? []).forEach((cid) => visit(cid, depth + 1))
  }
  visit(rootId, 0)
  return count
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
