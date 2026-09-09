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

/** 批注在块内的序号（从 1 开始，按 content 中出现的顺序） */
export function annOrdinal(content: ContentFragment[], upToIndex: number): number {
  let n = 0
  for (let i = 0; i <= upToIndex && i < content.length; i++) {
    if (isAnn(content[i])) n++
  }
  return n
}

/**
 * 遍历页面所有块（从 rootBlockId 出发），按文档顺序给每个批注分配全局序号（从 1 开始）。
 * 返回 Map<annId, 全局序号>。
 */
export function buildGlobalOrdinalMap(rootBlockId: DbId): Map<string, number> {
  const map = new Map<string, number>()
  let counter = 0
  const seen = new Set<DbId>()
  const MAX_DEPTH = 1000
  const visit = (id: DbId | undefined, depth: number) => {
    if (id == null || depth > MAX_DEPTH || seen.has(id)) return
    seen.add(id)
    const block = orca.state.blocks[id]
    if (block == null) return
    for (const f of block.content ?? []) {
      if (isAnn(f)) {
        counter++
        map.set(f.id, counter)
      }
    }
    ;(block.children ?? []).forEach((cid) => visit(cid, depth + 1))
  }
  visit(rootBlockId, 0)
  return map
}

/** 递归收集一棵块树内所有批注，附带所属块信息 */
export interface AnnEntry {
  ann: AnnFragment
  block: Block
  ordinal: number // 块内序号
}

export function collectAnnotations(rootBlockId: DbId): AnnEntry[] {
  const entries: AnnEntry[] = []
  const seen = new Set<DbId>()
  const MAX_DEPTH = 1000 // 防御异常数据（成环/超深）导致死循环
  const visit = (id: DbId | undefined, depth: number) => {
    if (id == null || depth > MAX_DEPTH || seen.has(id)) return
    seen.add(id)
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
    ;(block.children ?? []).forEach((cid) => visit(cid, depth + 1))
  }
  visit(rootBlockId, 0)
  return entries
}

/** 沿 parent 链回溯到根块（页面） */
export function rootOf(id: DbId, blocks: any): DbId {
  const visited = new Set<DbId>()
  let cur = blocks[id]
  while (cur != null && cur.parent != null && cur.parent !== "" && !visited.has(cur.id)) {
    visited.add(cur.id)
    cur = blocks[cur.parent]
  }
  return cur?.id as DbId
}

/** 页面（根块）标题：journal 显示日期，其余取别名 / text / _repr.cap */
export function pageTitle(block: any): string {
  if (block == null) return "未命名"
  const repr = block.properties?.find((p: any) => p.name === "_repr")?.value
  if (repr?.type === "journal") {
    try {
      const d = repr.date instanceof Date ? repr.date : new Date(repr.date)
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat((orca.state as any).locale || undefined, {
          dateStyle: "medium",
        }).format(d)
      }
    } catch { /* ignore */ }
  }
  if (block.aliases?.length) {
    const a = String(block.aliases[0])
    return a.startsWith("/") ? a.split("/").at(-1) ?? a : a
  }
  if (block.text != null) {
    const t = String(block.text).trim().replace(/(\s*#[^\s#]+)+$/u, "").trim()
    if (t) return t
  }
  return repr?.cap ? String(repr.cap) : "未命名"
}

/** 批注所在块的文本预览（截断到 60 字） */
export function blockPreview(entry: AnnEntry): string {
  const text = (entry.block.content ?? [])
    .map((f: any) => (typeof f?.v === "string" ? f.v : ""))
    .join("")
    .trim()
  return text.length > 60 ? text.slice(0, 60) + "…" : text
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

