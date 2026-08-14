// 批注汇总面板：列出当前文档所有批注，点击跳转到所在块
import type { DbId } from "./orca.d.ts"
import {
  collectAnnotations,
  findViewPanelByView,
  type AnnEntry,
} from "./ann"

const { useMemo } = window.React as any
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

/**
 * 从面板树中找到当前文档的根块 id。
 * 不依赖 addTo/goTo 的 viewArgs 传参（goTo 会清空 viewArgs），
 * 面板自给自足：优先找 block 视图面板，其次 journal 视图面板。
 */
function findDocumentRoot(panels: any): DbId | undefined {
  const bp = findViewPanelByView("block", panels)
  if (bp != null) {
    return (bp.viewState?.rootBlockId as DbId) ?? (bp.viewArgs?.blockId as DbId)
  }
  const jp = findViewPanelByView("journal", panels)
  if (jp != null) {
    return jp.viewState?.rootBlockId as DbId
  }
  return undefined
}

/**
 * 面板渲染器。
 * 通过 viewArgs.rootBlockId 或面板树定位当前文档；跳转后保持面板不关闭。
 */
export default function PizhuPanel(props: {
  panelId: string
  viewArgs?: Record<string, any>
  viewState?: Record<string, any>
}) {
  const { blocks, panels, activePanel } = useSnapshot(orca.state)
  const panelId = props.panelId ?? activePanel

  // 当前文档根块：优先 viewArgs（预留），否则从面板树反查
  const rootBlockId: DbId | undefined = useMemo(
    () =>
      (props.viewArgs?.rootBlockId as DbId | undefined) ??
      findDocumentRoot(panels),
    [props.viewArgs, panels],
  )

  const entries: AnnEntry[] = useMemo(
    () => (rootBlockId == null ? [] : collectAnnotations(rootBlockId)),
    [rootBlockId, blocks],
  )

  const jump = (blockId: DbId) => {
    orca.nav.goTo("block", { blockId })
  }

  const remove = async (e: React.MouseEvent, blockId: DbId, annId: string) => {
    e.stopPropagation()
    await orca.commands.invokeCommand(
      `${pluginPrefix}.ann.remove`,
      blockId,
      annId,
    )
  }

  return (
    <div className="pizhu-panel">
      <div className="pizhu-panel-header">
        批注 <span className="pizhu-panel-count">{entries.length}</span>
      </div>
      {entries.length === 0 ? (
        <div className="pizhu-panel-empty">
          当前文档还没有批注。
          <br />
          选中文字后按 Ctrl+Alt+A 添加。
        </div>
      ) : (
        <div className="pizhu-panel-list">
          {entries.map((entry) => (
            <div
              key={entry.ann.id}
              className="pizhu-panel-item"
              onClick={() => jump(entry.block.id)}
            >
              <div className="pizhu-panel-item-top">
                <span className="pizhu-panel-ordinal">{entry.ordinal}</span>
                <span className="pizhu-panel-original">{entry.ann.v}</span>
                <span className="pizhu-panel-item-spacer" />
                <button
                  className="pizhu-panel-del"
                  title="删除批注"
                  onClick={(e) => remove(e, entry.block.id, entry.ann.id)}
                >
                  ✕
                </button>
              </div>
              {entry.ann.note && (
                <div className="pizhu-panel-note">{entry.ann.note}</div>
              )}
              <div className="pizhu-panel-blockref">{blockPreview(entry)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
