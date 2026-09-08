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
