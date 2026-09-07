// 顶栏批注下拉卡：Popup 组件锚定顶栏按钮，汇总当前文档所有批注（替代原侧栏）
import type { DbId } from "./orca.d.ts"
import { collectAnnotations, findViewPanelByView, type AnnEntry } from "./ann"
import { annIndex, rebuildIndex } from "./index"
import { t } from "./libs/l10n"

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

/** 当前文档批注（DFS 序号），供"仅当前文档"与分组切换前的实时显示 */
function currentDocEntries(rootBlockId: DbId | undefined, blocks: any): AnnEntry[] {
  return rootBlockId == null ? [] : collectAnnotations(rootBlockId)
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
    () => currentDocEntries(rootBlockId, blocks),
    [rootBlockId, blocks],
  )
  // 全库索引可订阅状态（"全部文档"数据源；重建完成后响应式更新）
  const idxSnap = useSnapshot(annIndex) as any
  const [rebuildBusy, setRebuildBusy] = useState(false)
  // 生效范围的批注总数：all = 全库索引总数，doc = 当前文档
  const totalCount = scope === "all" ? idxSnap.totalCount : entries.length

  const { Button, Popup } = orca.components as any

  const jump = (blockId: DbId) => {
    orca.nav.goTo("block", { blockId })
    setOpen(false)
  }

  const remove = async (e: any, blockId: DbId, annId: string) => {
    e.stopPropagation()
    await orca.commands.invokeCommand(`${pluginPrefix}.ann.remove`, blockId, annId)
  }

  // 重建索引：全库重扫，完成后响应式刷新列表与徽标
  const onRebuild = async () => {
    if (rebuildBusy || idxSnap.state === "building") return
    setRebuildBusy(true)
    const res = await rebuildIndex()
    setRebuildBusy(false)
    try {
      if (res.ok) {
        orca.notify("success", t("Index rebuilt: ${n} annotations in ${d} documents", {
          n: String(res.totalCount),
          d: String(res.docCount),
        }), { title: t("Annotation index") })
      } else {
        orca.notify("error", t("Index rebuild failed: ${error}", { error: res.error ?? "unknown" }), { title: t("Annotation index") })
      }
    } catch {
      /* 忽略通知异常 */
    }
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
          title={t("Remove annotation")}
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

  // 全库索引条目渲染（AnnIndexItem：内容取自索引快照，无需对应块在内存）
  const renderIndexItem = (item: any, ordinal: number) => (
    <div
      key={item.id}
      className="pizhu-pop-item"
      onClick={() => jump(item.blockId)}
    >
      <div className="pizhu-pop-item-top">
        <span className="pizhu-pop-ordinal">{ordinal}</span>
        <span className="pizhu-pop-original">{item.v}</span>
        <span className="pizhu-pop-item-spacer" />
        <button
          className="pizhu-pop-del"
          title={t("Remove annotation")}
          onClick={(e: any) => remove(e, item.blockId, item.id)}
        >
          ✕
        </button>
      </div>
      {item.note && <div className="pizhu-pop-note">{item.note}</div>}
      {item.preview && <div className="pizhu-pop-blockref">{item.preview}</div>}
    </div>
  )

  const renderAllList = () => (
    <div className="pizhu-pop-list">
      {idxSnap.docs.map((g: any) => (
        <div key={g.rootId} className="pizhu-pop-page">
          <div className="pizhu-pop-page-title">{g.title}</div>
          {g.anns.map((item: any, i: number) => renderIndexItem(item, i + 1))}
        </div>
      ))}
    </div>
  )

  return (
    <>
      <span ref={btnRef} className="pizhu-pop-anchor">
        <Button
          variant="plain"
          onClick={() => setOpen(!open)}
          title={t("Annotations")}
        >
          <span className="pizhu-headbar-btn">
            <i className="ti ti-notes" /> {t("Annotations")}
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
            {t("Annotations")} <span className="pizhu-pop-count">{totalCount}</span>
            <span className="pizhu-pop-item-spacer" />
            {scope === "all" && (
              <>
                <button
                  className="pizhu-pop-rebuild"
                  onClick={onRebuild}
                  disabled={rebuildBusy || idxSnap.state === "building"}
                  title={t("Rebuild index: rescan all documents")}
                >
                  {rebuildBusy || idxSnap.state === "building"
                    ? t("Indexing…")
                    : t("Rebuild index")}
                </button>
              </>
            )}
            <button
              className="pizhu-pop-scope"
              onClick={toggleScope}
              title={scope === "doc" ? t("Switch: show annotations from all documents") : t("Switch: show current document only")}
            >
              {scope === "doc" ? t("Current document only") : t("All documents")}
            </button>
          </div>
          {scope === "all" && idxSnap.state !== "ready" && idxSnap.docs.length === 0 ? (
            <div className="pizhu-pop-empty">{t("Indexing, please try again shortly…")}</div>
          ) : totalCount === 0 ? (
            <div className="pizhu-pop-empty">
              {scope === "doc" ? t("No annotations in this document") : t("No annotations in any document")}
              <br />
              {t("Add by selecting text and pressing Ctrl+Alt+A")}
            </div>
          ) : (
            scope === "all" ? (
              idxSnap.docs.length > 0 ? (
                renderAllList()
              ) : (
                <div className="pizhu-pop-empty">{t("Indexing, please try again shortly…")}</div>
              )
            ) : (
              <div className="pizhu-pop-list">
                {entries.map((entry) => renderItem(entry))}
              </div>
            )
          )}
        </div>
      </Popup>
    </>
  )
}
