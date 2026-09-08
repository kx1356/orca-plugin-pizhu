// 顶栏批注下拉卡：Popup 组件锚定顶栏按钮，汇总当前文档所有批注（替代原侧栏）
import type { DbId } from "./orca.d.ts"
import {
  collectAnnotations,
  findViewPanelByView,
  pageTitle,
  rootOf,
  blockPreview,
  type AnnEntry,
} from "./ann"
import { ensureMemCache, getCachedPages, refreshDocCache, type CachedPage } from "./annCache"

const { useState, useRef, useEffect, useMemo } = window.React as any
const { useSnapshot } = window.Valtio as any

// 插件名前缀（命令 ID 必须带此前缀），由 main.tsx 在 load 时设置
let pluginPrefix = "orca-pizhu"
export function setPluginPrefix(p: string) {
  pluginPrefix = p
}

/** journal 视图的日期参数 → get-journal-block 后端可接受的格式 */
function normalizeJournalDate(date: any): any {
  if (date == null) return null
  if (date instanceof Date) return date
  if (typeof date === "string") return date
  if (typeof date === "object" && ("t" in date || "v" in date)) return date
  return date
}

/** 通过 get-journal-block 后端 API 从日期获取 journal 页面根块 id */
async function fetchJournalRootBlockId(date: any): Promise<DbId | undefined> {
  const d = normalizeJournalDate(date)
  if (d == null) return undefined
  try {
    let result: any
    try {
      result = await orca.invokeBackend("get-journal-block", d)
    } catch {
      result = await orca.invokeBackend("get-journal-block", orca.state.repo, d)
    }
    if (result == null) return undefined
    if (typeof result === "object") return result.id as DbId
    return result as DbId
  } catch {
    return undefined
  }
}

/** 兜底：遍历所有 blocks，找第一个含批注的块，沿 parent 链回溯到根块 */
function fallbackRootFromBlocks(blocks: any): DbId | undefined {
  let annBlockId: DbId | undefined
  for (const id of Object.keys(blocks)) {
    const blk = blocks[id]
    const content = Array.isArray(blk?.content) ? blk.content : []
    if (content.some((f: any) => f && f.t === "pizhu.ann")) {
      annBlockId = id as unknown as DbId
      break
    }
  }
  if (annBlockId == null) return undefined
  let cur: any = blocks[annBlockId]
  const visited = new Set<DbId>()
  while (cur != null && cur.parent != null && cur.parent !== "" && !visited.has(cur.id)) {
    visited.add(cur.id)
    cur = blocks[cur.parent]
  }
  return cur?.id as DbId | undefined
}

/** 同步定位：block 视图直接命中；journal 视图返回 undefined（交给异步补） */
function findDocumentRootSync(panels: any): DbId | undefined {
  const bp = findViewPanelByView("block", panels)
  if (bp != null) {
    const bid = (bp.viewState?.rootBlockId as DbId) ?? (bp.viewArgs?.blockId as DbId)
    if (bid != null) return bid
  }
  const jp = findViewPanelByView("journal", panels)
  if (jp != null) {
    const rs = jp.viewState?.rootBlockId as DbId | undefined
    if (rs != null) return rs
  }
  return undefined
}

/** 异步定位：journal 视图从 date 换根块 id，兜底遍历 blocks */
async function findDocumentRoot(panels: any): Promise<DbId | undefined> {
  const bp = findViewPanelByView("block", panels)
  if (bp != null) {
    const bid = (bp.viewState?.rootBlockId as DbId) ?? (bp.viewArgs?.blockId as DbId)
    if (bid != null) return bid
  }
  const jp = findViewPanelByView("journal", panels)
  if (jp != null) {
    const date = jp.viewArgs?.date ?? jp.viewState?.date
    if (date != null) {
      const rid = await fetchJournalRootBlockId(date)
      if (rid != null) return rid
    }
    const rs = jp.viewState?.rootBlockId as DbId | undefined
    if (rs != null) return rs
  }
  return fallbackRootFromBlocks((orca.state as any).blocks)
}

/** 下拉卡渲染条目（内存实时或缓存统一转换后的瘦身形状） */
interface PopEntry {
  key: string // React key：ann id（全局唯一）
  id: string // ann fragment id
  v: string // 原文
  note: string // 批注内容
  ordinal: number // 块内序号
  blockId: DbId
  preview: string // 块文本预览
}

/** 全部文档的批注分组（按页面） */
interface AnnPageGroup {
  rootId: DbId
  title: string
  entries: PopEntry[]
}

/** 内存实时条目 → PopEntry */
function toPopEntry(e: AnnEntry): PopEntry {
  return {
    key: e.ann.id,
    id: e.ann.id,
    v: e.ann.v,
    note: e.ann.note ?? "",
    ordinal: e.ordinal,
    blockId: e.block.id as DbId,
    preview: blockPreview(e),
  }
}

/** 扫描 blocks 全表：含批注的块 → 回溯根块去重 → 每个根块收集批注；当前文档排最前，其余按标题排序 */
function collectAllGroups(blocks: any, currentRootId: DbId | undefined): AnnPageGroup[] {
  const rootSet = new Set<DbId>()
  for (const id of Object.keys(blocks)) {
    const content = blocks[id]?.content
    if (Array.isArray(content) && content.some((f: any) => f?.t === "pizhu.ann")) {
      rootSet.add(rootOf(id as unknown as DbId, blocks))
    }
  }
  const groups: AnnPageGroup[] = []
  for (const rid of rootSet) {
    const entries = collectAnnotations(rid)
    if (entries.length === 0) continue
    groups.push({
      rootId: rid,
      title: pageTitle(blocks[rid]),
      entries: entries.map(toPopEntry),
    })
  }
  groups.sort((a, b) => {
    if (a.rootId === currentRootId) return -1
    if (b.rootId === currentRootId) return 1
    return a.title.localeCompare(b.title, "zh")
  })
  return groups
}
/** 合并内存表结果（实时、覆盖所有已加载文档）与缓存结果（曾打开过的文档），当前文档置顶 */
function mergeAllGroups(
  local: AnnPageGroup[],
  cached: CachedPage[],
  currentRootId: DbId | undefined,
): AnnPageGroup[] {
  const map = new Map<DbId, AnnPageGroup>()
  for (const g of local) map.set(g.rootId, g)
  for (const p of cached) {
    if (map.has(p.rootId) || p.anns.length === 0) continue // 内存实时优先
    map.set(p.rootId, {
      rootId: p.rootId,
      title: p.title,
      entries: p.anns.map((a) => ({
        key: a.id,
        id: a.id,
        v: a.v,
        note: a.note,
        ordinal: a.ordinal,
        blockId: a.blockId,
        preview: a.preview,
      })),
    })
  }
  const result = Array.from(map.values())
  result.sort((a, b) => {
    if (a.rootId === currentRootId) return -1
    if (b.rootId === currentRootId) return 1
    return a.title.localeCompare(b.title, "zh")
  })
  return result
}

/** 顶栏按钮 + Popup 下拉卡：点按钮展开汇总，点外部/Esc 关闭，不占分栏空间 */
export default function AnnPopupButton() {
  const { blocks, panels, plugins } = useSnapshot(orca.state)
  const [open, setOpen] = useState(false)
  const btnRef = useRef(null)
  const [asyncRootId, setAsyncRootId] = useState(undefined)
  // 显示范围：仅当前文档 / 全部文档（插件设置 popScope，Valtio 响应式）
  const scope: "doc" | "all" =
    (plugins as any)?.[pluginPrefix]?.settings?.popScope === "all" ? "all" : "doc"

  // 卡内切换：写入插件设置（app 级失败则回退 repo 级），与设置面板双向同步
  const toggleScope = async () => {
    const next = scope === "doc" ? "all" : "doc"
    const cur = { ...((orca.state as any).plugins?.[pluginPrefix]?.settings ?? {}) }
    cur.popScope = next
    try {
      await orca.plugins.setSettings("app", pluginPrefix, cur)
    } catch {
      try {
        await orca.plugins.setSettings("repo", pluginPrefix, cur)
      } catch { /* ignore */ }
    }
  }

  // 同步定位（block 视图命中；journal 视图返回 undefined，交由异步补）
  const syncRootId: DbId | undefined = useMemo(
    () => findDocumentRootSync(panels),
    [panels],
  )
  // 同步结果优先（权威），异步仅在同步拿不到时兜底（journal 视图）
  const rootBlockId: DbId | undefined = syncRootId ?? asyncRootId

  // journal 视图：异步换取根块 id（后端 API 必须在 useEffect 里调）
  useEffect(() => {
    let dead = false
    async function work() {
      const r = await findDocumentRoot(panels)
      if (!dead && r != null) setAsyncRootId(r)
    }
    if (syncRootId == null) work().catch(() => {})
    return () => { dead = true }
  }, [panels, syncRootId])

  const entries: AnnEntry[] = useMemo(
    () => (rootBlockId == null ? [] : collectAnnotations(rootBlockId)),
    [rootBlockId, blocks],
  )
  const [allGroups, setAllGroups] = useState([] as AnnPageGroup[])
  // 打开文档（rootBlockId 变化）→ 后台刷新该文档缓存（积累机制）
  useEffect(() => {
    if (rootBlockId != null) refreshDocCache(rootBlockId)
  }, [rootBlockId])
  useEffect(() => {
    if (scope !== "all") return
    let dead = false
    // ① 内存块表即时统计 + 已积累的磁盘缓存合并（无后端全库扫描）
    const update = () => {
      if (dead) return
      setAllGroups(
        mergeAllGroups(collectAllGroups(blocks, rootBlockId), getCachedPages(), rootBlockId),
      )
    }
    update()
    // ② 首次读盘（磁盘缓存就绪）后再合并一次
    void ensureMemCache().then(update)
    return () => { dead = true }
  }, [scope, blocks, rootBlockId])
  const groups: AnnPageGroup[] = scope === "all" ? allGroups : []
  const totalCount =
    scope === "all"
      ? groups.reduce((n, g) => n + g.entries.length, 0)
      : entries.length

  const { Button, Popup } = orca.components as any

  const jump = (blockId: DbId) => {
    orca.nav.goTo("block", { blockId })
    setOpen(false)
  }

  const remove = async (e: any, blockId: DbId, annId: string) => {
    e.stopPropagation()
    // 全部文档模式下可能命中未加载文档的批注，其块不在内存表，直接删无效
    if (!(orca.state as any).blocks?.[blockId]) {
      orca.notify?.("warn", "该批注所在文档尚未加载，请先点击条目跳转打开后再删除")
      return
    }
    await orca.commands.invokeCommand(`${pluginPrefix}.ann.remove`, blockId, annId)
  }

  const renderItem = (entry: PopEntry) => (
    <div
      key={entry.key}
      className="pizhu-pop-item"
      onClick={() => jump(entry.blockId)}
    >
      <div className="pizhu-pop-item-top">
        <span className="pizhu-pop-ordinal">{entry.ordinal}</span>
        <span className="pizhu-pop-original">{entry.v}</span>
        <span className="pizhu-pop-item-spacer" />
        <button
          className="pizhu-pop-del"
          title="删除批注"
          onClick={(e: any) => remove(e, entry.blockId, entry.id)}
        >
          ✕
        </button>
      </div>
      {entry.note && (
        <div className="pizhu-pop-note">{entry.note}</div>
      )}
      <div className="pizhu-pop-blockref">{entry.preview}</div>
    </div>
  )
  return (
    <>
      <span ref={btnRef} className="pizhu-pop-anchor">
        <Button
          variant="plain"
          onClick={() => setOpen(!open)}
          title="批注"
        >
          <span className="pizhu-headbar-btn">
            <i className="ti ti-notes" /> 批注
            {totalCount > 0 && (
              <span className="pizhu-pop-count">{totalCount}</span>
            )}
          </span>
        </Button>
      </span>
      <Popup
        refElement={btnRef}
        visible={open}
        onClose={() => setOpen(false)}
        placement="vertical"
        defaultPlacement="bottom"
        alignment="center"
        offset={6}
        escapeToClose
        className="pizhu-pop"
      >
        <div className="pizhu-pop-inner">
          <div className="pizhu-pop-header">
            批注 <span className="pizhu-pop-count">{totalCount}</span>
            <span className="pizhu-pop-item-spacer" />
            <button
              className="pizhu-pop-scope"
              onClick={toggleScope}
              title={scope === "doc" ? "切换：显示所有文档的批注" : "切换：只显示当前文档的批注"}
            >
              {scope === "doc" ? "仅当前文档" : "全部文档"}
            </button>
          </div>
          {totalCount === 0 ? (
            <div className="pizhu-pop-empty">
              {scope === "doc" ? "当前文档还没有批注。" : "所有文档都还没有批注。"}
              <br />
              选中文字后按 Ctrl+Alt+A 添加。
            </div>
          ) : (
            <div className="pizhu-pop-list">
              {scope === "all"
                ? groups.map((g) => (
                    <div key={g.rootId} className="pizhu-pop-page">
                      <div className="pizhu-pop-page-title">{g.title}</div>
                      {g.entries.map((entry) => renderItem(entry))}
                    </div>
                  ))
                : entries.map(toPopEntry).map((entry) => renderItem(entry))}
            </div>
          )}
        </div>
      </Popup>
    </>
  )
}
