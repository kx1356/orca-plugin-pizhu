// 全库批注索引（方案 B）：独立于 orca.state.blocks 的全库扫描索引。
// 解决的问题：orca.state.blocks 只含已加载到内存的块，"全部文档"统计会漏掉未打开文档的批注。
// 机制：通过后端 query 枚举所有文档根块 → get-block-tree 拉取整棵子树 → 统计 pizhu.ann 片段，
//       结果持久化到 plugin-data，并用 Valtio proxy 暴露给 UI。
//       提供 rebuildIndex()（重建索引，手动/首次加载触发）与 patchDoc()（编辑后增量修正当前文档）。
import type { DbId } from "./orca.d.ts"
import { isAnn } from "./ann"

const { proxy } = window.Valtio as any

/** 索引中单条批注（含展示所需快照，独立于状态，无需该块在内存） */
export interface AnnIndexItem {
  id: string // 批注 id
  blockId: DbId // 所在块
  rootId: DbId // 所在文档根块
  v: string // 被批注原文
  note: string
  created: number
  modified?: number
  preview: string // 所在块的文本预览
}

/** 按文档分组的全库索引 */
export interface AnnIndex {
  version: number
  updatedAt: number
  docs: {
    rootId: DbId
    title: string
    anns: AnnIndexItem[]
  }[]
}

/** 暴露给 UI 的可订阅状态 */
export const annIndex = proxy({
  state: "idle" as "idle" | "building" | "ready" | "error",
  dirty: false, // 有文档在索引后又被编辑过，建议重建
  updatedAt: undefined as number | undefined,
  totalCount: 0,
  docs: [] as AnnIndex["docs"],
})

let pluginName = "orca-pizhu"

export function setAnnIndexPluginName(p: string) {
  pluginName = p
}

function indexKey(repo: string) {
  return `pizhu-ann-index:${repo}`
}

function backend(): (name: string, ...args: any[]) => Promise<any> {
  return (name, ...args) => orca.invokeBackend(name, ...args)
}

/** 从后端读持久化索引（可能为 null） */
async function readPersisted(repo: string): Promise<AnnIndex | null> {
  try {
    const v = await orca.invokeBackend(
      "get-plugin-data",
      pluginName,
      indexKey(repo),
    )
    if (typeof v !== "string") return v as AnnIndex | null
    const parsed = JSON.parse(v)
    return parsed && Array.isArray(parsed.docs) ? (parsed as AnnIndex) : null
  } catch {
    return null
  }
}

async function persist(repo: string, idx: AnnIndex) {
  try {
    await orca.invokeBackend(
      "set-plugin-data",
      pluginName,
      indexKey(repo),
      JSON.stringify(idx),
    )
  } catch {
    /* 忽略持久化失败（仅影响下次启动是否需要重建） */
  }
}

/** 从块对象提取页面标题（journal → 日期，否则别名 / text / _repr.cap），与 popup 语义一致 */
function pageTitleOf(block: any): string {
  if (block == null) return "Untitled"
  const repr = block.properties?.find((p: any) => p.name === "_repr")?.value
  if (repr?.type === "journal") {
    try {
      const d = repr.date instanceof Date ? repr.date : new Date(repr.date)
      if (!isNaN(d.getTime())) {
        return new Intl.DateTimeFormat((orca.state as any).locale || undefined, {
          dateStyle: "medium",
        }).format(d)
      }
    } catch {
      /* ignore */
    }
  }
  if (Array.isArray(block.aliases) && block.aliases.length) {
    const a = String(block.aliases[0])
    return a.startsWith("/") ? a.split("/").at(-1) ?? a : a
  }
  if (block.text != null) {
    const text = String(block.text)
      .trim()
      .replace(/(\s*#[^\s#]+)+$/u, "")
      .trim()
    if (text) return text
  }
  return repr?.cap ? String(repr.cap) : "Untitled"
}

function stripRichText(f: any): string {
  return typeof f?.v === "string" ? f.v : ""
}

function blockPreview(content: any[], max = 80): string {
  const text = Array.isArray(content)
    ? content.map(stripRichText).join("").trim()
    : ""
  return text.length > max ? text.slice(0, max) + "…" : text
}

/**
 * 递归遍历整棵块树，收集所有 pizhu.ann 片段为 AnnIndexItem。
 * tree 形如 BlockForConversion：{ id, content, children }，children 为嵌套子块对象或 id。
 */
function walkTree(
  node: any,
  rootId: DbId,
  out: AnnIndexItem[],
  seen: Set<any>,
  depth: number,
) {
  if (node == null || depth > 1000) return
  const id = node.id
  if (id == null || seen.has(id)) return
  seen.add(id)
  const content = Array.isArray(node.content) ? node.content : []
  if (content.some((f: any) => f && f.t === "pizhu.ann")) {
    const preview = blockPreview(content)
    for (const f of content) {
      if (!isAnn(f)) continue
      out.push({
        id: f.id,
        blockId: id as DbId,
        rootId,
        v: typeof f.v === "string" ? f.v : "",
        note: typeof f.note === "string" ? f.note : "",
        created: f.created ?? 0,
        modified: f.modified,
        preview,
      })
    }
  }
  const children = Array.isArray(node.children) ? node.children : []
  for (const child of children) {
    if (child != null && typeof child === "object" && child.id != null) {
      walkTree(child, rootId, out, seen, depth + 1)
    }
  }
}

/** 拉取一棵文档树并收集批注（对 get-block-tree 返回做归一化） */
async function scanDoc(b: any, rootId: DbId): Promise<AnnIndexItem[]> {
  const tree: any = await b("get-block-tree", rootId)
  if (tree == null) return []
  const out: AnnIndexItem[] = []
  // 支持两种返回形态：根块对象直接带 content/children；或 { root, blocks } 扁平容器
  let rootNode = tree
  if (tree.root != null && (tree.blocks != null || tree.docs != null)) {
    rootNode = tree.root
  }
  const seen = new Set<any>()
  walkTree(rootNode, rootId, out, seen, 0)
  // 扁平容器形态：把全部块并入遍历（children 是 id 时按容器补齐内容）
  if (tree.blocks != null && typeof tree.blocks === "object") {
    for (const id of Object.keys(tree.blocks)) {
      const blk = tree.blocks[id]
      if (blk == null || typeof blk !== "object" || seen.has(blk.id)) continue
      walkTree(blk, rootId, out, seen, 0)
    }
  }
  return out
}

/** 构建页面标题：优先用根块对象；get-block-tree 返回树里若有块对象直接取 */
function titleOf(rootBlock: any, anns: AnnIndexItem[]): string {
  if (rootBlock != null) {
    const t = pageTitleOf(rootBlock)
    if (t && t !== "Untitled") return t
  }
  return "Untitled"
}

/**
 * 全库重建索引（核心）。
 * 策略：query 枚举"无父块"的根块 → get-block-tree 逐文档扫描统计。
 * 返回统计汇总供调用方提示。
 */
export async function rebuildIndex(): Promise<{
  ok: boolean
  totalCount: number
  docCount: number
  error?: string
}> {
  if (annIndex.state === "building") {
    return { ok: false, totalCount: annIndex.totalCount, docCount: 0, error: "busy" }
  }
  annIndex.state = "building"
  const repo = orca.state.repo
  const b = backend()
  try {
    // 1. 枚举所有根块（无父块的页面）
    let rootBlocks: any[] = []
    let rootsResult: any
    try {
      rootsResult = await b("query", {
        q: {
          kind: 1, // AND
          conditions: [{ kind: 9, hasParent: false, includeDescendants: false }], // 无父块的块
        },
      })
    } catch {
      rootsResult = null
    }
    rootBlocks = normalizeBlockArray(rootsResult)

    const docs: AnnIndex["docs"] = []
    let totalCount = 0
    const done = new Set<DbId>()
    for (const rb of rootBlocks) {
      const rootId = rb?.id as DbId
      if (rootId == null) continue
      if (done.has(rootId)) continue
      done.add(rootId)
      const anns = await scanDoc(b, rootId)
      if (anns.length === 0) continue
      totalCount += anns.length
      docs.push({ rootId, title: titleOf(rb, anns), anns })
    }
    docs.sort((a, b) => a.title.localeCompare(b.title, "zh"))

    const idx: AnnIndex = { version: 1, updatedAt: Date.now(), docs }
    annIndex.totalCount = totalCount
    annIndex.docs = docs
    annIndex.updatedAt = idx.updatedAt
    annIndex.dirty = false
    annIndex.state = "ready"
    await persist(repo, idx)
    return { ok: true, totalCount, docCount: docs.length }
  } catch (e) {
    annIndex.state = "error"
    annIndex.dirty = true
    return {
      ok: false,
      totalCount: annIndex.totalCount,
      docCount: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/** 对 query 返回做归一化：数组，或 { blocks: [...] } / { result: [...] } */
function normalizeBlockArray(res: any): any[] {
  if (Array.isArray(res)) return res
  if (res == null) return []
  if (Array.isArray(res.blocks)) return res.blocks
  if (Array.isArray(res.result)) return res.result
  if (Array.isArray(res.data)) return res.data
  return []
}

/**
 * 启动时确保索引存在：仅当无可读缓存才后台重建，避免每次加载全库扫描。
 */
export async function ensureIndex() {
  const repo = orca.state.repo
  try {
    const persisted = await readPersisted(repo)
    if (persisted && Array.isArray(persisted.docs)) {
      annIndex.totalCount = persisted.docs.reduce(
        (n, d) => n + (Array.isArray(d.anns) ? d.anns.length : 0),
        0,
      )
      annIndex.docs = persisted.docs
      annIndex.updatedAt = persisted.updatedAt
      annIndex.dirty = false
      annIndex.state = "ready"
      return
    }
  } catch {
    /* 走重建 */
  }
  await rebuildIndex()
}

/**
 * 编辑后增量修正缓存：根据可选 rootId 定位该文档分组，
 * 用当前内存状态重扫该文档，替换其分组并累计总数。
 * 找不到分组（该文档不在缓存中）则把 dirty 置真，提示走重建。
 */
export async function patchDoc(rootId: DbId | undefined) {
  if (annIndex.state !== "ready") return
  const repo = orca.state.repo
  if (rootId == null) {
    annIndex.dirty = true
    return
  }
  const blocks = (orca.state as any).blocks ?? {}
  // 从内存状态重建该文档的树形（DFS 优先，仅访问加载中的块）
  const anns: AnnIndexItem[] = []
  const visited = new Set<DbId>()
  const MAX = 1000
  const visit = (id: DbId | undefined, depth: number) => {
    if (id == null || depth > MAX || visited.has(id)) return
    visited.add(id)
    const blk = blocks[id]
    if (blk == null) return
    const content = Array.isArray(blk.content) ? blk.content : []
    if (content.some((f: any) => f && f.t === "pizhu.ann")) {
      const preview = blockPreview(content)
      for (const f of content) {
        if (!isAnn(f)) continue
        anns.push({
          id: f.id,
          blockId: id,
          rootId,
          v: typeof f.v === "string" ? f.v : "",
          note: typeof f.note === "string" ? f.note : "",
          created: f.created ?? 0,
          modified: f.modified,
          preview,
        })
      }
    }
    ;(Array.isArray(blk.children) ? blk.children : []).forEach((c: DbId) =>
      visit(c, depth + 1),
    )
  }
  visit(rootId, 0)

  const docs = annIndex.docs.slice()
  const gi = docs.findIndex((d: any) => d.rootId === rootId)
  let total = 0
  for (let i = 0; i < docs.length; i++) {
    if (docs[i].rootId === rootId) {
      docs[i] = { ...docs[i], anns }
    }
  }
  if (gi < 0) {
    // 文档不在索引里：说明整档批注都是缓存之后新增的，补一组
    const rb = blocks[rootId]
    if (rb != null && anns.length > 0) {
      docs.push({ rootId, title: pageTitleOf(rb), anns })
    }
  }
  for (const d of docs) total += d.anns.length
  annIndex.docs = docs
  annIndex.totalCount = total
  annIndex.dirty = true
  // 异步落盘
  const idx: AnnIndex = {
    version: 1,
    updatedAt: annIndex.updatedAt ?? Date.now(),
    docs,
  }
  return persist(repo, idx).catch(() => {})
}