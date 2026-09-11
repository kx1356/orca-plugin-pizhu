// 行内渲染器：波浪线 + 角标数字，悬停浮窗预览，点击弹出批注卡
import type { Block, ContentFragment, DbId } from "./orca.d.ts"
import { ANN_COLORS, buildGlobalOrdinalMap, isAnn, rootOf } from "./ann"
import { invokeAnnCommand } from "./commands"
import { annCard, closeAnnCard, openAnnCard } from "./store"
import { t } from "./libs/l10n"

const { useState, useRef, useEffect } = window.React as any
const { useSnapshot } = window.Valtio as any
const { createPortal } = window.ReactDOM as any

// 插件名前缀（命令 ID 必须带此前缀），由 main.tsx 在 load 时设置
let pluginPrefix = "orca-pizhu"
export function setPluginPrefix(p: string) {
  pluginPrefix = p
}

// 页面全局序号缓存：以 blocks 快照对象为键，同一快照下每个页面只构建一次序号表，
// 避免页面上每个批注行内组件都各自做一次全页遍历（O(批注数 × 页块数)）。
const ordinalCache = new WeakMap<object, Map<string, Map<string, number>>>()
function globalOrdinalMapFor(
  blocks: Record<string | DbId, Block | undefined>,
  rootId: DbId | string,
): Map<string, number> {
  const key = String(rootId)
  let byRoot = ordinalCache.get(blocks)
  if (byRoot == null) {
    byRoot = new Map()
    ordinalCache.set(blocks, byRoot)
  }
  let map = byRoot.get(key)
  if (map == null) {
    map = buildGlobalOrdinalMap(rootId as DbId, blocks)
    byRoot.set(key, map)
  }
  return map
}

/**
 * 行内渲染器 props：blockId 所属块、data 当前 fragment。
 * 注意：data 可能不是最新快照，批注卡编辑后由 useSnapshot 订阅刷新。
 */
export default function AnnotationInline({
  blockId,
  data,
}: {
  blockId: DbId | string
  data: ContentFragment
}) {
  const { blocks } = useSnapshot(orca.state)
  const annCardSnap = useSnapshot(annCard)
  const ann = isAnn(data) ? data : null

  // 页面范围的全局批注序号（跨块递增）：遍历 root 下所有块建立 map（按快照缓存）
  const ordinal = (() => {
    if (!ann) return 0
    const rootId = rootOf(blockId as any, blocks)
    return globalOrdinalMapFor(blocks, rootId).get(ann.id) ?? 0
  })()

  // 悬停预览浮窗状态
  const [previewPos, setPreviewPos] = useState(
    null as { x: number; y: number } | null,
  )
  const hideTimer = useRef(null) as any

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

  // 还原批注创建时的原文样式（字号/颜色/粗斜体），并叠加批注自定义颜色
  const textStyle: React.CSSProperties = {}
  try {
    if (ann.domStyle) {
      if (ann.domStyle.fontSize) textStyle.fontSize = ann.domStyle.fontSize
      if (ann.domStyle.color) textStyle.color = ann.domStyle.color
      if (ann.domStyle.fontWeight) textStyle.fontWeight = ann.domStyle.fontWeight
      if (ann.domStyle.fontStyle) textStyle.fontStyle = ann.domStyle.fontStyle
    }
    if (ann.color) textStyle.textDecorationColor = ann.color
  } catch {
    /* 忽略样式解析异常，不影响批注功能 */
  }
  const badgeStyle: React.CSSProperties | undefined = ann.color
    ? { background: ann.color }
    : undefined

  return (
    <>
      <span
        className="orca-inline pizhu-ann"
        data-ann-id={ann.id}
        style={textStyle}
        onClick={handleClick}
        onMouseEnter={showPreview}
        onMouseLeave={scheduleHide}
      >
        <span className="pizhu-ann-text">{ann.v}</span>
        <sup className="pizhu-ann-badge" style={badgeStyle}>{ordinal}</sup>
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

/** 汇总页里的跳转芯片：点击跳到批注所在块 */
export function AnnotationRefInline({ data }: { data: any }) {
  const target = Number(data?.v)
  const color = typeof data?.color === "string" && data.color ? data.color : undefined
  const label = data?.ordinal ? `#${data.ordinal}` : "↗"
  const onClick = (e: any) => {
    e.preventDefault()
    e.stopPropagation()
    if (Number.isFinite(target)) orca.nav.goTo("block", { blockId: target })
  }
  return (
    <span
      className="orca-inline pizhu-ref-chip"
      style={color ? { color, borderColor: color } : undefined}
      onClick={onClick}
      title={t("Jump to annotation")}
    >
      {label}
    </span>
  )
}

/** 批注卡浮层：显示原文、编辑批注、选择颜色、保存/删除 */
export function AnnotationCard() {
  const card = useSnapshot(annCard)
  const { blocks } = useSnapshot(orca.state)
  const [draft, setDraft] = useState("")
  const [color, setColor] = useState("")
  const taRef = useRef(null) as any

  const block = card.blockId == null ? undefined : (blocks[card.blockId] as Block | undefined)
  const ann = (block?.content ?? []).find((f) => isAnn(f) && f.id === card.annId)

  // 打开/切换批注时用该批注内容与颜色初始化草稿（卡片常驻挂载，state 不随 annId 重置）
  useEffect(() => {
    setDraft(ann?.note ?? "")
    setColor(ann?.color ?? "")
  }, [card.annId, card.visible])

  // 批注已不存在（可能被删除）时自动关闭。
  // 必须在 effect 中改全局状态，渲染期间 setState 是 React 反模式。
  useEffect(() => {
    if (!card.visible || card.blockId == null) return
    if (!ann) closeAnnCard()
  }, [card.visible, card.blockId, card.annId, blocks])

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

  // 批注已被删除：渲染空（关闭由上方 useEffect 处理）
  if (!card.visible || card.blockId == null || !ann) return null

  const save = async () => {
    if (draft.trim() === "") {
      orca.notify("warn", t("Annotation content cannot be empty"))
      return
    }
    try {
      await invokeAnnCommand(
        `${pluginPrefix}.ann.edit`,
        card.blockId,
        card.annId,
        draft.trim(),
        color,
      )
    } catch (e: any) {
      orca.notify?.("error", `${t("Failed to save annotation")}: ${e?.message ?? e}`)
      return
    }
    closeAnnCard()
  }

  const remove = async () => {
    try {
      await invokeAnnCommand(
        `${pluginPrefix}.ann.remove`,
        card.blockId,
        card.annId,
      )
    } catch (e: any) {
      orca.notify?.("error", `${t("Failed to delete annotation")}: ${e?.message ?? e}`)
      return
    }
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
        <div className="pizhu-card-original" title={t("Original text")}>
          {ann.v}
        </div>
        <textarea
          ref={taRef}
          className="pizhu-card-input"
          rows={1}
          placeholder={t("Write a note…")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onInput={autoResize}
          autoFocus
        />
        <div className="pizhu-prompt-colors pizhu-card-colors">
          {ANN_COLORS.map((c) => (
            <button
              key={c || "auto"}
              type="button"
              className={
                "pizhu-color-swatch" +
                (c === "" ? " pizhu-color-auto" : "") +
                (c === color ? " pizhu-color-on" : "")
              }
              style={{ background: c || "var(--pizhu-accent)" }}
              title={c || t("Follow theme")}
              aria-label={c || t("Follow theme")}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="pizhu-card-actions">
        <button className="pizhu-card-btn pizhu-card-btn-danger" onClick={remove}>
          {t("Delete")}
        </button>
        <span className="pizhu-card-spacer" />
        <button className="pizhu-card-btn" onClick={closeAnnCard}>
          {t("Cancel")}
        </button>
        <button className="pizhu-card-btn pizhu-card-btn-primary" onClick={save}>
          {t("Save")}
        </button>
      </div>
    </div>
  )
}
