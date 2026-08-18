// 行内渲染器：波浪线 + 角标数字，悬停浮窗预览，点击弹出批注卡
import type { Block, ContentFragment, DbId } from "./orca.d.ts"
import { annOrdinal, isAnn } from "./ann"
import { annCard, closeAnnCard, openAnnCard } from "./store"

const { useState, useRef, useEffect } = window.React as any
const { useSnapshot } = window.Valtio as any
const { createPortal } = window.ReactDOM as any

// 插件名前缀（命令 ID 必须带此前缀），由 main.tsx 在 load 时设置
let pluginPrefix = "orca-pizhu"
export function setPluginPrefix(p: string) {
  pluginPrefix = p
}

/**
 * 行内渲染器 props：blockId 所属块、data 当前 fragment、index 在块 content 中的位置。
 * 注意：data 可能不是最新快照，批注卡编辑后由 useSnapshot 订阅刷新。
 */
export default function AnnotationInline({
  blockId,
  data,
  index,
}: {
  blockId: DbId | string
  data: ContentFragment
  index: number
}) {
  const { blocks } = useSnapshot(orca.state)
  const annCardSnap = useSnapshot(annCard)
  const block = blocks[blockId] as Block | undefined
  const ann = isAnn(data) ? data : null

  // 块内批注序号：统计当前 fragment 之前（含自身）的批注数量
  const ordinal = ann ? annOrdinal(block?.content ?? [], index) : 0

  // 悬停预览浮窗状态
  const [previewPos, setPreviewPos] = useState(
    null as { x: number; y: number } | null,
  )
  const hideTimer = useRef(null) as any
  const elRef = useRef(null) as any

  useEffect(
    () => () => {
      if (hideTimer.current != null) clearTimeout(hideTimer.current)
    },
    [],
  )

  if (!ann) return <span className="orca-inline">{String(data.v ?? "")}</span>

  const showPreview = (e: React.MouseEvent) => {
    // 编辑批注卡打开时，悬停预览失效，避免与编辑卡重叠干扰
    if (annCardSnap.visible) {
      setPreviewPos(null)
      return
    }
    // 鼠标进入标记/浮窗：清除隐藏定时器
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    // 以鼠标位置为基准偏移定位，避免手型指针遮挡浮窗内容
    const mx = e.clientX
    const my = e.clientY
    let x = mx + 14
    let y = my + 16
    if (x + 300 > window.innerWidth) x = mx - 290
    if (y + 150 > window.innerHeight) y = my - 160
    setPreviewPos({ x, y })
  }

  // 浮窗上悬停：只维持显示，不重新定位（避免跳动）
  const cancelHide = () => {
    if (hideTimer.current != null) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }

  const scheduleHide = () => {
    if (hideTimer.current != null) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setPreviewPos(null), 160)
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setPreviewPos(null)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    openAnnCard(blockId as DbId, ann.id, rect.left, rect.bottom + 6)
  }

  // 还原批注创建时的原文样式（字号/颜色/粗斜体），防御性解析
  const textStyle: React.CSSProperties = {}
  try {
    if (ann.domStyle) {
      if (ann.domStyle.fontSize) textStyle.fontSize = ann.domStyle.fontSize
      if (ann.domStyle.color) textStyle.color = ann.domStyle.color
      if (ann.domStyle.fontWeight) textStyle.fontWeight = ann.domStyle.fontWeight
      if (ann.domStyle.fontStyle) textStyle.fontStyle = ann.domStyle.fontStyle
    }
  } catch {
    /* 忽略样式解析异常，不影响批注功能 */
  }

  return (
    <>
      <span
        ref={elRef}
        className="orca-inline pizhu-ann"
        data-ann-id={ann.id}
        style={textStyle}
        onClick={handleClick}
        onMouseEnter={showPreview}
        onMouseLeave={scheduleHide}
      >
        <span className="pizhu-ann-text">{ann.v}</span>
        <sup className="pizhu-ann-badge">{ordinal}</sup>
      </span>
      {previewPos != null &&
        createPortal(
          <div
            className="pizhu-preview"
            style={{
              position: "fixed",
              left: previewPos.x,
              top: previewPos.y,
              zIndex: 9995,
            }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
          >
            <div className="pizhu-preview-note">{ann.note || ann.v}</div>
          </div>,
          document.body,
        )}
    </>
  )
}

/** 批注卡浮层：显示原文、编辑批注、保存/删除 */
export function AnnotationCard() {
  const card = useSnapshot(annCard)
  const { blocks } = useSnapshot(orca.state)
  const [draft, setDraft] = useState("")
  const taRef = useRef(null) as any

  // 编辑框根据文字内容自动伸缩高度（打开与输入时生效）
  const autoResize = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = "auto"
    ta.style.height = `${ta.scrollHeight}px`
  }
  useEffect(() => {
    if (card.visible) autoResize()
  })

  const cardRef = useRef(null) as any
  // 卡片不超出视口：底部越界则上移，顶部越界则下移到顶，确保操作按钮始终可见
  useEffect(() => {
    if (!card.visible) return
    const el = cardRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const m = 8
    if (r.bottom > window.innerHeight - m) {
      el.style.top = `${Math.max(m, window.innerHeight - r.height - m)}px`
    } else if (r.top < m) {
      el.style.top = `${m}px`
    }
  })

  // Esc 关闭编辑卡（输入框内 Esc 同样生效）
  useEffect(() => {
    if (!card.visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAnnCard()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [card.visible])

  if (!card.visible || card.blockId == null) return null

  const block = blocks[card.blockId] as Block | undefined
  const ann = (block?.content ?? []).find((f) => isAnn(f) && f.id === card.annId)

  if (!ann) {
    // 批注已不存在（可能被删除），自动关闭
    closeAnnCard()
    return null
  }

  const save = async () => {
    if (draft.trim() === "") return
    await orca.commands.invokeCommand(
      `${pluginPrefix}.ann.edit`,
      card.blockId,
      card.annId,
      draft.trim(),
    )
    closeAnnCard()
  }

  const remove = async () => {
    await orca.commands.invokeCommand(
      `${pluginPrefix}.ann.remove`,
      card.blockId,
      card.annId,
    )
    closeAnnCard()
  }

  const style: React.CSSProperties = {
    position: "fixed",
    left: card.x,
    top: card.y,
    zIndex: 9999,
    minWidth: 260,
    maxWidth: 380,
  }

  return (
    <div
      ref={cardRef}
      className="pizhu-card"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="pizhu-card-scroll">
        <div className="pizhu-card-original" title="原文">
          {ann.v}
        </div>
        <textarea
          ref={taRef}
          className="pizhu-card-input"
          rows={1}
          placeholder="写下批注…"
          value={draft || ann.note}
          onChange={(e) => setDraft(e.target.value)}
          onInput={autoResize}
          autoFocus
        />
      </div>
      <div className="pizhu-card-actions">
        <button className="pizhu-card-btn pizhu-card-btn-danger" onClick={remove}>
          删除
        </button>
        <span className="pizhu-card-spacer" />
        <button className="pizhu-card-btn" onClick={closeAnnCard}>
          取消
        </button>
        <button className="pizhu-card-btn pizhu-card-btn-primary" onClick={save}>
          保存
        </button>
      </div>
    </div>
  )
}
