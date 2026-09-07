// 顶栏批注下拉卡：Popup 组件锚定顶栏按钮，汇总当前文档所有批注（替代原侧栏）
import type { DbId } from "./orca.d.ts"
import { collectAnnotations, findViewPanelByView, type AnnEntry } from "./ann"

const { useState, useRef, useEffect, useMemo } = window.React as any
const { useSnapshot } = window.Valtio as any

// 插件名前缀（命令 ID 必须带此前缀），由 main.tsx 在 load 时设置
let pluginPrefix = "orca-pizhu"
export function setPluginPrefix(p: string) {
  pluginPrefix = p
}

function stripRichText(f: any): string {
  return typeof f?.v === "string" ? f.v : ""
}

function blockPreview(entry: AnnEntry): string {
  const text = (entry.block.content ?? [])
    .map(stripRichText)
    .join("")
    .trim()
  return text.length > 60 ? text.slice(0, 60) + "…" : text
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

/** 沿 parent 链回溯到根块（页面） */
function rootOf(id: DbId, blocks: any): DbId {
  const visited = new Set<DbId>()
  let cur = blocks[id]
  while (cur != null && cur.parent != null && cur.parent !== "" && !visited.has(cur.id)) {
    visited.add(cur.id)
    cur = blocks[cur.parent]
  }
  return cur?.id as DbId
}

/** 页面（根块）标题：journal 显示日期，其余取别名 / text / _repr.cap */
function pageTitle(block: any): string {
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

/** 全部文档的批注分组（按页面） */
interface AnnPageGroup {
  rootId: DbId
  title: string
  entries: AnnEntry[]
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
    groups.push({ rootId: rid, title: pageTitle(blocks[rid]), entries })
  }
  groups.sort((a, b) => {
    if (a.rootId === currentRootId) return -1
    if (b.rootId === currentRootId) return 1
    return a.title.localeCompare(b.title, "zh")
  })
  return groups
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
  // 全部模式：按页面分组收集所有文档的批注
  const groups: AnnPageGroup[] = useMemo(
    () => (scope === "all" ? collectAllGroups(blocks, rootBlockId) : []),
    [scope, blocks, rootBlockId],
  )
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
    await orca.commands.invokeCommand(`${pluginPrefix}.ann.remove`, blockId, annId)
  }

  const renderItem = (entry: AnnEntry) => (
    <div
      key={entry.ann.id}
      className="pizhu-pop-item"
      onClick={() => jump(entry.block.id)}
    >
      <div className="pizhu-pop-item-top">
        <span className="pizhu-pop-ordinal">{entry.ordinal}</span>
        <span className="pizhu-pop-original">{entry.ann.v}</span>
        <span className="pizhu-pop-item-spacer" />
        <button
          className="pizhu-pop-del"
          title="删除批注"
          onClick={(e: any) => remove(e, entry.block.id, entry.ann.id)}
        >
          ✕
        </button>
      </div>
      {entry.ann.note && (
        <div className="pizhu-pop-note">{entry.ann.note}</div>
      )}
      <div className="pizhu-pop-blockref">{blockPreview(entry)}</div>
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
            {entries.length > 0 && (
              <span className="pizhu-pop-count">{entries.length}</span>
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
                : entries.map((entry) => renderItem(entry))}
            </div>
          )}
        </div>
      </Popup>
    </>
  )
}
