// 批注跨文档索引缓存：随使用持续积累「曾打开过的文档」的批注，
// 供顶栏下拉卡「全部文档」模式使用（不依赖后端全库扫描 API）。
// 刷新时机：文档打开（rootBlockId 变化）＋ 批注增删改命令成功后。
import type { DbId } from "./orca.d.ts"
import { collectAnnotations, pageTitle, blockPreview, rootOf, type AnnEntry } from "./ann"

/** 缓存中一条批注的瘦身表示（渲染/跳转所需字段，不存整块以避免体积膨胀） */
export interface CachedAnn {
  id: string // ann fragment id
  v: string // 原文
  note: string // 批注内容
  ordinal: number // 块内序号
  blockId: DbId
  preview: string // 块文本预览
}

/** 缓存中一个文档（页面）的批注 */
export interface CachedPage {
  rootId: DbId
  title: string
  updated: number // 最后更新时间戳（用于淘汰最旧的）
  anns: CachedAnn[]
}

let pluginPrefix = "orca-pizhu"
export function setPluginPrefix(p: string) {
  pluginPrefix = p
}

const CACHE_KEY = "ann-cache-v1"
const MAX_PAGES = 500 // 缓存文档数上限，超出淘汰最久未更新的

// 内存缓存（key 统一为 String(rootId)）：session 内复用，避免反复读盘；磁盘写入防抖批量落盘
let memCache: Record<string, CachedPage> = {}
let memCacheReady: Promise<void> | null = null
let flushTimer: any = null

/** 首次读取磁盘缓存 → 内存（只执行一次，失败静默） */
export function ensureMemCache(): Promise<void> {
  if (memCacheReady == null) {
    memCacheReady = (async () => {
      try {
        const raw: any = await orca.plugins.getData(pluginPrefix, CACHE_KEY)
        if (typeof raw === "string" && raw) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === "object") {
            memCache = parsed
          }
        }
      } catch {
        /* 读盘失败忽略，内存为空但不影响功能 */
      }
    })()
  }
  return memCacheReady
}

/** 防抖持久化到磁盘（全量写） */
function persist() {
  if (flushTimer != null) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    try {
      void orca.plugins.setData(pluginPrefix, CACHE_KEY, JSON.stringify(memCache))
    } catch { /* ignore */ }
  }, 300)
}

/** 取全部缓存页（供「全部文档」模式合并） */
export function getCachedPages(): CachedPage[] {
  return Object.values(memCache)
}

/** 从缓存中移除单条批注（按 ann id） */
export function removeCachedAnn(annId: string): boolean {
  let changed = false
  for (const key of Object.keys(memCache)) {
    const page = memCache[key]
    const before = page.anns.length
    page.anns = page.anns.filter((a) => a.id !== annId)
    if (page.anns.length !== before) {
      changed = true
      if (page.anns.length === 0) delete memCache[key]
      else page.updated = Date.now()
    }
  }
  if (changed) persist()
  return changed
}

/** 按块/页面 id 批量清理缓存条目（页面根命中则整页移除） */
export function removeCachedByIds(ids: (DbId | string)[]): number {
  if (ids.length === 0) return 0
  const set = new Set(ids.map((i) => String(i)))
  let removed = 0
  for (const key of Object.keys(memCache)) {
    const page = memCache[key]
    if (set.has(String(page.rootId))) {
      removed += page.anns.length
      delete memCache[key]
      continue
    }
    const kept = page.anns.filter((a) => !set.has(String(a.blockId)))
    if (kept.length !== page.anns.length) {
      removed += page.anns.length - kept.length
      if (kept.length === 0) delete memCache[key]
      else { page.anns = kept; page.updated = Date.now() }
    }
  }
  if (removed > 0) persist()
  return removed
}

/** 检查块在后端是否存在（get-block 直接查库，与是否加载到内存无关） */
async function blockExists(blockId: DbId | string | undefined): Promise<boolean> {
  if (blockId == null) return false
  try {
    const blk: any = await orca.invokeBackend("get-block" as any, blockId)
    return blk != null
  } catch {
    return false
  }
}

/** 清理缓存中源页面/块已不存在的批注，返回移除条数 */
export async function pruneStaleCache(): Promise<number> {
  await ensureMemCache()
  let removed = 0
  for (const key of Object.keys(memCache)) {
    const page = memCache[key]
    if (page == null) { delete memCache[key]; continue }
    if (!(await blockExists(page.rootId))) {
      removed += page.anns.length
      delete memCache[key]
      continue
    }
    const flags = await Promise.all(page.anns.map((a) => blockExists(a.blockId)))
    const kept = page.anns.filter((_, i) => flags[i])
    if (kept.length !== page.anns.length) {
      removed += page.anns.length - kept.length
      if (kept.length === 0) delete memCache[key]
      else { page.anns = kept; page.updated = Date.now() }
    }
  }
  if (removed > 0) persist()
  return removed
}

/** 刷新单个文档的批注缓存：以内存块表为准（加载中的文档块表完整），无批注则移除该项 */
export function refreshDocCache(rootId: DbId | undefined): void {
  if (rootId == null) return
  void ensureMemCache().then(() => {
    const blocks = (orca.state as any).blocks ?? {}
    const entries: AnnEntry[] = collectAnnotations(rootId)
    const sk = String(rootId)
    if (entries.length === 0) {
      if (memCache[sk] != null) {
        delete memCache[sk]
        persist()
      }
      return
    }
    const page: CachedPage = {
      rootId,
      title: pageTitle(blocks[rootId]),
      updated: Date.now(),
      anns: entries.map((e) => ({
        id: e.ann.id,
        v: e.ann.v,
        note: e.ann.note ?? "",
        ordinal: e.ordinal,
        blockId: e.block.id as DbId,
        preview: blockPreview(e),
      })),
    }
    memCache[sk] = page
    // 超限淘汰最久未更新的
    const keys = Object.keys(memCache)
    if (keys.length > MAX_PAGES) {
      const sorted = keys.sort((a, b) => memCache[a].updated - memCache[b].updated)
      for (const k of sorted.slice(0, keys.length - MAX_PAGES)) delete memCache[k]
    }
    persist()
  })
}

/** 按块 id 刷新所属文档缓存（批注命令成功后调用） */
export function refreshDocCacheByBlock(blockId: DbId | undefined): void {
  if (blockId == null) return
  const blocks = (orca.state as any).blocks ?? {}
  if (blocks[blockId as unknown as string] == null) return
  refreshDocCache(rootOf(blockId, blocks))
}
