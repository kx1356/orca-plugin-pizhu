// 批注收集与分组：内存块表 + 跨文档缓存合并（下拉卡与汇总页共用）
import type { DbId } from "./orca.d.ts"
import { blockPreview, pageTitle, rootOf, type AnnEntry } from "./ann"
import type { CachedPage } from "./annCache"

/** 渲染条目（内存实时或缓存统一转换后的瘦身形状） */
export interface PopEntry {
  key: string // React key：ann id（全局唯一）
  id: string // ann fragment id
  v: string // 原文
  note: string // 批注内容
  ordinal: number // 块内序号
  blockId: DbId
  preview: string // 块文本预览
  color?: string // 批注自定义颜色
}

/** 按页面分组的批注 */
export interface AnnPageGroup {
  rootId: DbId
  title: string
  entries: PopEntry[]
}

/** 内存实时条目 → PopEntry */
export function toPopEntry(e: AnnEntry): PopEntry {
  return {
    key: e.ann.id,
    id: e.ann.id,
    v: e.ann.v,
    note: e.ann.note ?? "",
    ordinal: e.ordinal,
    blockId: e.block.id as DbId,
    preview: blockPreview(e),
    color: e.ann.color,
  }
}

/** 块内容 → 文本预览（截断到 60 字），与 ann.blockPreview 同规则 */
export function previewOfContent(content: any[]): string {
  const text = content
    .map((f) => (typeof f?.v === "string" ? f.v : ""))
    .join("")
    .trim()
  return text.length > 60 ? text.slice(0, 60) + "…" : text
}

/** 单次扫描 blocks 全表，按根块分组收集批注；当前文档排最前，其余按标题排序 */
export function collectAllGroups(blocks: any, currentRootId: DbId | undefined): AnnPageGroup[] {
  // 以 String(rootId) 为分组键：根块 id 在内存表与缓存中可能分别是 number/string，
  // 统一字符串化可避免同一页面被拆成两组而出现重复条目。
  const map = new Map<string, AnnPageGroup>()
  const seenAnn = new Set<string>() // 批注 id 全局唯一，兜底去重
  for (const id of Object.keys(blocks)) {
    const content = blocks[id]?.content
    if (!Array.isArray(content)) continue
    const realId = (blocks[id]?.id ?? id) as DbId
    let ordinal = 0
    let preview: string | null = null
    let group: AnnPageGroup | undefined
    for (const f of content) {
      if (f?.t !== "pizhu.ann") continue
      ordinal++
      if (f.id && seenAnn.has(f.id)) continue
      if (f.id) seenAnn.add(f.id)
      if (group == null) {
        const rid = rootOf(realId, blocks)
        const key = String(rid)
        group = map.get(key)
        if (group == null) {
          group = { rootId: rid, title: pageTitle(blocks[rid]), entries: [] }
          map.set(key, group)
        }
      }
      if (preview == null) preview = previewOfContent(content)
      group.entries.push({
        key: f.id,
        id: f.id,
        v: f.v,
        note: f.note ?? "",
        ordinal,
        blockId: realId,
        preview,
        color: f.color,
      })
    }
  }
  return sortGroups(Array.from(map.values()), currentRootId)
}

/** 合并内存表结果（实时）与缓存结果（曾打开过的文档），当前文档置顶 */
export function mergeAllGroups(
  local: AnnPageGroup[],
  cached: CachedPage[],
  currentRootId: DbId | undefined,
): AnnPageGroup[] {
  // 统一以 String(rootId) 为键，避免 number/string 不一致导致同页重复
  const map = new Map<string, AnnPageGroup>()
  const seenAnn = new Set<string>()
  for (const g of local) {
    map.set(String(g.rootId), g)
    for (const e of g.entries) if (e.id) seenAnn.add(e.id)
  }
  for (const p of cached) {
    if (map.has(String(p.rootId)) || p.anns.length === 0) continue // 内存实时优先
    const entries: PopEntry[] = p.anns
      .filter((a) => !a.id || !seenAnn.has(a.id))
      .map((a) => ({
        key: a.id,
        id: a.id,
        v: a.v,
        note: a.note,
        ordinal: a.ordinal,
        blockId: a.blockId,
        preview: a.preview,
      }))
    if (entries.length === 0) continue
    for (const e of entries) if (e.id) seenAnn.add(e.id)
    map.set(String(p.rootId), { rootId: p.rootId, title: p.title, entries })
  }
  return sortGroups(Array.from(map.values()), currentRootId)
}

/** 当前文档置顶，其余按标题排序 */
function sortGroups(groups: AnnPageGroup[], currentRootId: DbId | undefined): AnnPageGroup[] {
  groups.sort((a, b) => {
    if (String(a.rootId) === String(currentRootId)) return -1
    if (String(b.rootId) === String(currentRootId)) return 1
    return a.title.localeCompare(b.title, "zh")
  })
  return groups
}
