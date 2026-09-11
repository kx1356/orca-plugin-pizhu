// 顶栏批注下拉卡：Popup 组件锚定顶栏按钮，汇总当前/全部文档的批注
import type { DbId } from "./orca.d.ts"
import { collectAnnotations, findViewPanelByView, type AnnEntry } from "./ann"
import { ensureMemCache, getCachedPages, refreshDocCache, removeCachedAnn, pruneStaleCache } from "./annCache"
import { collectAllGroups, mergeAllGroups, toPopEntry, type PopEntry, type AnnPageGroup } from "./collect"
import { invokeAnnCommand } from "./commands"
import { generateSummary } from "./summary"
import { t } from "./libs/l10n"

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

type SortMode = "position" | "original" | "note"
const SORT_ORDER: SortMode[] = ["position", "original", "note"]
const SORT_LABEL: Record<SortMode, string> = {
  position: "Position",
  original: "Original",
  note: "Note",
}

/** 按关键字过滤条目 */
function matchEntry(e: PopEntry, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return (
    e.v.toLowerCase().includes(s) ||
    e.note.toLowerCase().includes(s) ||
    e.preview.toLowerCase().includes(s)
  )
}

/** 对条目排序（position 保持原序） */
function sortEntries(list: PopEntry[], mode: SortMode): PopEntry[] {
  if (mode === "position") return list
  const arr = list.slice()
  if (mode === "original") arr.sort((a, b) => a.v.localeCompare(b.v, "zh"))
  else arr.sort((a, b) => a.note.localeCompare(b.note, "zh"))
  return arr
}

/** 顶栏按钮 + Popup 下拉卡：点按钮展开汇总，点外部/Esc 关闭，不占分栏空间 */
export default function AnnPopupButton() {
  const { blocks, panels, plugins } = useSnapshot(orca.state)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("position" as SortMode)
  const [activeIndex, setActiveIndex] = useState(0)
  const btnRef = useRef(null)
  const innerRef = useRef(null) as any
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

  const entries: AnnEntry[] = useMemo(() => {
    if (rootBlockId == null) return []
    const seen = new Set<string>()
    return collectAnnotations(rootBlockId).filter((e) => {
      if (seen.has(e.ann.id)) return false
      seen.add(e.ann.id)
      return true
    })
  }, [rootBlockId, blocks])
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

  // 过滤 + 排序后的可见数据
  const docList: PopEntry[] = useMemo(
    () => sortEntries(entries.map(toPopEntry).filter((e) => matchEntry(e, query)), sort),
    [entries, query, sort],
  )
  const filteredGroups: AnnPageGroup[] = useMemo(() => {
    if (scope !== "all") return []
    return (allGroups as AnnPageGroup[])
      .map((g: AnnPageGroup) => ({
        ...g,
        entries: sortEntries(
          g.entries.filter((e: PopEntry) => matchEntry(e, query)),
          sort as SortMode,
        ),
      }))
      .filter((g: AnnPageGroup) => g.entries.length > 0)
  }, [scope, allGroups, query, sort])

  // 键盘导航用的扁平列表
  const navList: PopEntry[] = useMemo(
    () => (scope === "all" ? filteredGroups.flatMap((g) => g.entries) : docList),
    [scope, filteredGroups, docList],
  )
  const totalCount = navList.length

  // 搜索/范围/排序变化时重置键盘选中项
  useEffect(() => {
    setActiveIndex(0)
  }, [query, scope, sort, open])

  // 打开时聚焦列表容器以接收键盘操作
  useEffect(() => {
    if (open) innerRef.current?.focus?.()
  }, [open])

  const { Button, Popup } = orca.components as any

  const jump = (blockId: DbId) => {
    orca.nav.goTo("block", { blockId })
    setOpen(false)
  }

  /** 缓存变化后刷新「全部文档」列表 */
  const recomputeAll = () => {
    if (scope !== "all") return
    setAllGroups(
      mergeAllGroups(collectAllGroups(blocks, rootBlockId), getCachedPages(), rootBlockId),
    )
  }

  const remove = async (e: any, blockId: DbId, annId: string) => {
    e.stopPropagation()
    // 全部文档模式下可能命中未加载文档的批注，其块不在内存表
    if (!(orca.state as any).blocks?.[blockId]) {
      let exists = false
      try {
        const blk: any = await orca.invokeBackend("get-block" as any, blockId)
        exists = blk != null
      } catch {
        exists = false
      }
      if (exists) {
        orca.notify?.("warn", t("Open this annotation's document before deleting"))
        return
      }
      // 源块已不存在：只清理失效缓存条目
      removeCachedAnn(annId)
      orca.notify?.("success", t("Removed stale annotation from cache"))
      recomputeAll()
      return
    }
    try {
      await invokeAnnCommand(`${pluginPrefix}.ann.remove`, blockId, annId)
    } catch (err: any) {
      orca.notify?.("error", `${t("Failed to delete annotation")}: ${err?.message ?? err}`)
    }
  }

  const [busyClean, setBusyClean] = useState(false)
  const cleanStale = async () => {
    setBusyClean(true)
    try {
      const n = await pruneStaleCache()
      orca.notify?.(
        "success",
        n > 0
          ? t("Removed ${count} stale annotations", { count: String(n) })
          : t("No stale annotations"),
      )
      recomputeAll()
    } catch (err: any) {
      orca.notify?.("error", `${t("Failed to prune stale annotations")}: ${err?.message ?? err}`)
    } finally {
      setBusyClean(false)
    }
  }

  const [busySummary, setBusySummary] = useState(false)
  const makeSummary = async () => {
    setBusySummary(true)
    try {
      const { pageId, count } = await generateSummary(pluginPrefix)
      orca.notify?.("success", t("Summary page updated (${count})", { count: String(count) }))
      setOpen(false)
      orca.nav.goTo("block", { blockId: pageId })
    } catch (e: any) {
      orca.notify?.("error", `${t("Failed to generate summary")}: ${e?.message ?? e}`)
    } finally {
      setBusySummary(false)
    }
  }

  const copyAll = async () => {
    const lines: string[] = [`## ${t("Annotations")} (${totalCount})`, ""]
    let n = 0
    for (const e of navList) {
      n++
      lines.push(`${n}. ${e.v}${e.note ? ` — ${e.note}` : ""}`)
      if (e.preview) lines.push(`   > ${e.preview}`)
    }
    const md = lines.join("\n")
    try {
      await navigator.clipboard.writeText(md)
      orca.notify?.("success", t("Copied annotations"))
    } catch {
      try {
        const ta = document.createElement("textarea")
        ta.value = md
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        ta.remove()
        orca.notify?.("success", t("Copied annotations"))
      } catch {
        orca.notify?.("error", t("Copy failed"))
      }
    }
  }

  const onKeyDown = (e: any) => {
    if (navList.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIndex((i: number) => Math.min(navList.length - 1, i + 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i: number) => Math.max(0, i - 1))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const target = navList[Math.min(activeIndex, navList.length - 1)]
      if (target) jump(target.blockId)
    }
  }

  const renderItem = (entry: PopEntry, index: number) => (
    <div
      key={entry.key}
      className={"pizhu-pop-item" + (index === activeIndex ? " pizhu-pop-item-active" : "")}
      role="button"
      tabIndex={0}
      aria-label={entry.v}
      onClick={() => jump(entry.blockId)}
      onMouseEnter={() => setActiveIndex(index)}
      onKeyDown={(e: any) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(entry.blockId) }
      }}
    >
      <div className="pizhu-pop-item-top">
        <span className="pizhu-pop-ordinal">{entry.ordinal}</span>
        {entry.color && (
          <span className="pizhu-pop-color" style={{ background: entry.color }} aria-hidden="true" />
        )}
        <span className="pizhu-pop-original">{entry.v}</span>
        <span className="pizhu-pop-item-spacer" />
        <button
          className="pizhu-pop-del"
          title={t("Delete annotation")}
          aria-label={t("Delete annotation")}
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

  // 全局导航序号：全部文档模式下需要跨组连续编号以匹配 navList
  let flatIndex = -1

  return (
    <>
      <span ref={btnRef} className="pizhu-pop-anchor">
        <Button
          variant="plain"
          onClick={() => setOpen(!open)}
          title={t("Annotations")}
        >
          <span className="pizhu-headbar-btn">
            <svg
              className="pizhu-headbar-icon"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 11.4q1.25 -1.1 2.5 0t2.5 0t2.5 0t2.5 0" />
              <circle cx="12.6" cy="4.4" r="1.7" />
            </svg> {t("Annotation")}
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
        <div className="pizhu-pop-inner" ref={innerRef} tabIndex={0} onKeyDown={onKeyDown}>
          <div className="pizhu-pop-header">
            {t("Annotations")} <span className="pizhu-pop-count">{totalCount}</span>
            <span className="pizhu-pop-item-spacer" />
            <button
              className="pizhu-pop-icon-btn"
              onClick={makeSummary}
              disabled={busySummary}
              title={t("Generate summary page")}
              aria-label={t("Generate summary page")}
            >
              ▤
            </button>
            <button
              className="pizhu-pop-icon-btn"
              onClick={copyAll}
              disabled={totalCount === 0}
              title={t("Copy all")}
              aria-label={t("Copy all")}
            >
              ⧉
            </button>
            <button
              className="pizhu-pop-scope"
              onClick={toggleScope}
              title={scope === "doc" ? t("Switch: show annotations in all documents") : t("Switch: show only the current document's annotations")}
            >
              {scope === "doc" ? t("Current document only") : t("All documents")}
            </button>
          </div>
          <div className="pizhu-pop-toolbar">
            <input
              className="pizhu-pop-search"
              type="search"
              value={query}
              placeholder={t("Search annotations…")}
              onChange={(e: any) => setQuery(e.target.value)}
            />
            <button
              className="pizhu-pop-sort"
              title={t("Sort")}
              onClick={() => setSort((SORT_ORDER[(SORT_ORDER.indexOf(sort as SortMode) + 1) % SORT_ORDER.length]))}
            >
              {t("Sort")}: {t(SORT_LABEL[sort as SortMode])}
            </button>
            <button
              className="pizhu-pop-sort"
              title={t("Prune stale annotations")}
              onClick={cleanStale}
              disabled={busyClean}
            >
              {busyClean ? t("Pruning…") : t("Prune")}
            </button>
          </div>
          {totalCount === 0 ? (
            <div className="pizhu-pop-empty">
              {query
                ? t("No matching annotations.")
                : scope === "doc"
                  ? t("No annotations in this document.")
                  : t("No annotations in any document.")}
              {!query && (
                <>
                  <br />
                  {t("Add by selecting text and pressing Ctrl+Alt+A")}
                </>
              )}
            </div>
          ) : (
            <div className="pizhu-pop-list">
              {scope === "all"
                ? filteredGroups.map((g) => (
                    <div key={g.rootId} className="pizhu-pop-page">
                      <div className="pizhu-pop-page-title">{g.title}</div>
                      {g.entries.map((entry) => {
                        flatIndex++
                        return renderItem(entry, flatIndex)
                      })}
                    </div>
                  ))
                : docList.map((entry, i) => renderItem(entry, i))}
            </div>
          )}
        </div>
      </Popup>
    </>
  )
}
