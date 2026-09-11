// 批注命令：选区添加（支持跨块）、编辑、删除（均可撤销）
import type { Block, ContentFragment, CursorNodeData, DbId } from "./orca.d.ts"
import {
  ANN_COLORS,
  ANN_TYPE,
  genAnnId,
  isAnn,
  rangeHasAnn,
  removeAnn,
  replaceRange,
  siblingRange,
  updateAnn,
  extractRange,
  type AnnFragment,
  type RangePos,
} from "./ann"
import { refreshDocCacheByBlock } from "./annCache"
import { t } from "./libs/l10n"

/** 保存 blocks content 的辅助函数 */
async function setBlockContent(
  cursor: any,
  blockId: DbId,
  content: ContentFragment[],
) {
  await orca.commands.invokeEditorCommand(
    "core.editor.setBlocksContent",
    cursor,
    [{ id: blockId, content }],
    cursor != null, // setBackCursor 仅在提供光标上下文时启用
  )
}

/** 命令写回内容后，同步 orca.state.blocks 快照，让订阅方（批注下拉卡等）即时刷新 */
function syncBlockContent(blockId: DbId, content: ContentFragment[]) {
  try {
    const blocks = (orca.state as any).blocks ?? {}
    const blk = blocks[blockId]
    if (blk == null) return
    blocks[blockId] = { ...blk, content }
  } catch { /* ignore */ }
}

/** 从 content 中按 id 找批注 fragment */
function findAnn(content: ContentFragment[], annId: string): AnnFragment | null {
  const found = content.find((f) => isAnn(f) && f.id === annId)
  return found != null && isAnn(found) ? found : null
}

/** 取节点对应的元素（文本节点取父元素） */
function nodeElement(node: Node | null): HTMLElement | null {
  if (node == null) return null
  return node.nodeType === Node.ELEMENT_NODE
    ? (node as HTMLElement)
    : node.parentElement
}

/** 读取单个元素的关键文字样式（字号/颜色/粗斜体） */
function readStyle(el: HTMLElement): Record<string, string> | undefined {
  const cs = window.getComputedStyle(el)
  const style: Record<string, string> = {}
  if (cs.fontSize) style.fontSize = cs.fontSize
  if (cs.color) style.color = cs.color
  if (cs.fontWeight && cs.fontWeight !== "normal") style.fontWeight = cs.fontWeight
  if (cs.fontStyle && cs.fontStyle !== "normal") style.fontStyle = cs.fontStyle
  return Object.keys(style).length > 0 ? style : undefined
}

/** 关键样式键是否一致 */
function sameStyle(a: Record<string, string>, b: Record<string, string>): boolean {
  return (
    a.fontSize === b.fontSize &&
    a.color === b.color &&
    a.fontWeight === b.fontWeight &&
    a.fontStyle === b.fontStyle
  )
}

/**
 * 从 DOM 捕获选中文字的实际样式快照（字号/颜色/粗斜体）。
 * 用计算样式而非内部格式结构，任何字号存储方式都能正确还原。
 * 选区首尾样式不一致（跨样式选区，如普通文字+行内代码）时视为捕获不到，
 * 保持块级继承，避免把起点样式错误覆盖到整段选区。
 */
function captureSelectionStyle(): Record<string, string> | undefined {
  try {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return undefined
    const range = sel.getRangeAt(0)
    const startEl = nodeElement(range.startContainer)
    if (!startEl) return undefined
    const start = readStyle(startEl)
    if (start == null) return undefined
    const endEl = nodeElement(range.endContainer)
    if (endEl != null && endEl !== startEl) {
      const end = readStyle(endEl)
      if (end != null && !sameStyle(start, end)) return undefined
    }
    return start
  } catch {
    return undefined
  }
}

/** 批注输入结果 */
interface PromptResult {
  note: string
  color: string
}

/**
 * 弹出批注输入（自绘 DOM 浮层，Promise 化），含颜色选择。
 * 返回 null 表示取消。
 */
function promptNote(
  initial: string,
  text: string,
  initialColor: string,
): Promise<PromptResult | null> {
  return new Promise((resolve) => {
    const mask = document.createElement("div")
    mask.className = "pizhu-prompt-mask"

    const card = document.createElement("div")
    card.className = "pizhu-prompt-card"

    const label = document.createElement("div")
    label.className = "pizhu-prompt-label"
    label.textContent = `${t("Annotation")}: ${text.slice(0, 30)}${text.length > 30 ? "…" : ""}`

    const input = document.createElement("textarea")
    input.className = "pizhu-prompt-input"
    input.rows = 4
    input.placeholder = t("Write your thoughts…")

    // 颜色选择
    let color = initialColor
    const colors = document.createElement("div")
    colors.className = "pizhu-prompt-colors"
    for (const c of ANN_COLORS) {
      const sw = document.createElement("button")
      sw.type = "button"
      sw.className = "pizhu-color-swatch" + (c === "" ? " pizhu-color-auto" : "")
      sw.style.background = c || "var(--pizhu-accent)"
      sw.title = c || t("Follow theme")
      sw.setAttribute("aria-label", c || t("Follow theme"))
      if (c === color) sw.classList.add("pizhu-color-on")
      sw.addEventListener("click", () => {
        color = c
        colors.querySelectorAll(".pizhu-color-swatch").forEach((el) => el.classList.remove("pizhu-color-on"))
        sw.classList.add("pizhu-color-on")
      })
      colors.appendChild(sw)
    }

    const actions = document.createElement("div")
    actions.className = "pizhu-prompt-actions"

    const cancelBtn = document.createElement("button")
    cancelBtn.type = "button"
    cancelBtn.className = "pizhu-prompt-btn pizhu-prompt-cancel"
    cancelBtn.textContent = t("Cancel")

    const okBtn = document.createElement("button")
    okBtn.type = "button"
    okBtn.className = "pizhu-prompt-btn pizhu-prompt-ok"
    okBtn.textContent = t("OK")

    actions.append(cancelBtn, okBtn)
    card.append(label, input, colors, actions)
    mask.appendChild(card)
    document.body.appendChild(mask)

    input.value = initial

    const done = (value: PromptResult | null) => {
      mask.remove()
      resolve(value)
    }
    const ok = () => {
      const note = input.value.trim()
      if (!note) {
        orca.notify("warn", t("Annotation content cannot be empty"))
        return
      }
      done({ note, color })
    }

    okBtn.addEventListener("click", ok)
    cancelBtn.addEventListener("click", () => done(null))
    mask.addEventListener("mousedown", (e) => {
      if (e.target === mask) done(null)
    })
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        ok()
      } else if (e.key === "Escape") {
        e.preventDefault()
        done(null)
      }
    })
    input.focus()
  })
}

/** 一个待批注的块区间 */
interface Segment {
  blockId: DbId
  start: RangePos
  end: RangePos
}

/**
 * 根据选区计算要批注的一个或多个块区间。
 * 同块直接返回单段；跨块时取同父下按文档顺序的兄弟块，首块取到末尾、末块从头取、中间块整块。
 * 父块不同或无法确定顺序时返回 null（不支持）。
 */
function buildSegments(
  blocks: Record<string | DbId, Block | undefined>,
  start: CursorNodeData,
  end: CursorNodeData,
): Segment[] | null {
  if (start.blockId === end.blockId) {
    return [{ blockId: start.blockId as DbId, start, end }]
  }
  const ids = siblingRange(blocks, start.blockId as DbId, end.blockId as DbId)
  if (ids == null) return null
  const segs: Segment[] = []
  for (const id of ids) {
    const content = blocks[id]?.content ?? []
    const last = Math.max(0, content.length - 1)
    if (id === start.blockId) {
      segs.push({ blockId: id, start: { ...start }, end: { index: last, offset: 1e9 } })
    } else if (id === end.blockId) {
      segs.push({ blockId: id, start: { index: 0, offset: 0 }, end: { ...end } })
    } else {
      segs.push({ blockId: id, start: { index: 0, offset: 0 }, end: { index: last, offset: 1e9 } })
    }
  }
  return segs
}

/**
 * 注册所有批注相关命令。
 * @param pluginName 插件名（前缀）
 */
export function registerCommands(pluginName: string) {
  // ============ 选区添加批注（编辑器命令，支持撤销） ============
  const addCmd = `${pluginName}.ann.add`
  if (orca.state.commands[addCmd] == null) {
    orca.commands.registerEditorCommand(
      addCmd,
      async ([, , cursor]): Promise<any> => {
        if (cursor == null) {
          orca.notify("warn", t("Please select text to annotate first"))
          return null
        }
        const { anchor, focus } = cursor
        const start = cursor.isForward ? anchor : focus
        const end = cursor.isForward ? focus : anchor
        const blocks = orca.state.blocks as Record<string | DbId, Block | undefined>

        const segments = buildSegments(blocks, start, end)
        if (segments == null) {
          orca.notify("warn", t("Cross-parent annotation is not supported"))
          return null
        }

        // 阻止与已有批注重叠（避免嵌套批注）
        for (const seg of segments) {
          const content = blocks[seg.blockId]?.content ?? []
          if (rangeHasAnn(content, seg.start, seg.end)) {
            orca.notify("warn", t("Selection overlaps an existing annotation"))
            return null
          }
        }

        // 提示标签用整段选中文本
        let labelText = ""
        for (const seg of segments) {
          const content = blocks[seg.blockId]?.content ?? []
          labelText += extractRange(content, seg.start, seg.end).text
        }
        if (!labelText) {
          orca.notify("warn", t("No text selected"))
          return null
        }

        // 捕获选中文字的实际样式（字号等）。必须在弹输入框之前：
        // 浮层弹出会抢走选区，之后再读 getSelection 只能拿到默认样式。
        const domStyle = captureSelectionStyle()

        const res = await promptNote("", labelText, "")
        if (res == null) return null // 用户取消

        // 记录所有参与块的旧内容用于撤销
        const oldContents = segments.map((seg) => ({
          blockId: seg.blockId,
          content: (blocks[seg.blockId]?.content ?? []).slice(),
        }))

        for (const seg of segments) {
          const old = oldContents.find((o) => o.blockId === seg.blockId)
          if (old == null) continue
          const { fragments, text } = extractRange(old.content, seg.start, seg.end)
          if (!text) continue
          const ann: AnnFragment = {
            t: ANN_TYPE,
            v: text,
            id: genAnnId(),
            note: res.note,
            texts: fragments,
            created: Date.now(),
            ...(res.color ? { color: res.color } : {}),
            ...(domStyle ? { domStyle } : {}),
          }
          const newContent = replaceRange(old.content, seg.start, seg.end, ann)
          await setBlockContent(cursor, seg.blockId, newContent)
          syncBlockContent(seg.blockId, newContent)
          refreshDocCacheByBlock(seg.blockId)
        }

        // 返回撤销数据：恢复所有块的旧 content
        return { ret: null, undoArgs: { contents: oldContents } }
      },
      async (
        _panelId: string,
        undoArgs: { contents: { blockId: DbId; content: ContentFragment[] }[] },
      ) => {
        if (undoArgs == null) return
        for (const { blockId, content } of undoArgs.contents) {
          await setBlockContent(null, blockId, content)
          syncBlockContent(blockId, content)
          refreshDocCacheByBlock(blockId)
        }
      },
      { label: t("Add annotation") },
    )
  }

  // ============ 编辑批注（编辑器命令，支持撤销） ============
  const editCmd = `${pluginName}.ann.edit`
  if (orca.state.commands[editCmd] == null) {
    orca.commands.registerEditorCommand(
      editCmd,
      async (_, blockId: DbId, annId: string, note: string, color?: string): Promise<any> => {
        const block = orca.state.blocks[blockId] as Block | undefined
        if (block == null) return null
        const content = block.content ?? []
        if (findAnn(content, annId) == null) return null
        const oldContent = content.slice()
        const patch: Partial<Pick<AnnFragment, "note" | "modified" | "color">> = {
          note,
          modified: Date.now(),
        }
        if (color !== undefined) patch.color = color
        const newContent = updateAnn(content, annId, patch)
        await setBlockContent(null, blockId, newContent)
        syncBlockContent(blockId, newContent)
        refreshDocCacheByBlock(blockId)
        return { ret: null, undoArgs: { blockId, oldContent } }
      },
      async (_panelId: string, undoArgs: { blockId: DbId; oldContent: ContentFragment[] }) => {
        if (undoArgs == null) return
        await setBlockContent(null, undoArgs.blockId, undoArgs.oldContent)
        syncBlockContent(undoArgs.blockId, undoArgs.oldContent)
        refreshDocCacheByBlock(undoArgs.blockId)
      },
      { label: t("Edit annotation"), hasArgs: true, noFocusNeeded: true },
    )
  }

  // ============ 删除批注（编辑器命令，支持撤销） ============
  const removeCmd = `${pluginName}.ann.remove`
  if (orca.state.commands[removeCmd] == null) {
    orca.commands.registerEditorCommand(
      removeCmd,
      async (_, blockId: DbId, annId: string): Promise<any> => {
        const block = orca.state.blocks[blockId] as Block | undefined
        if (block == null) return null
        const content = block.content ?? []
        if (findAnn(content, annId) == null) return null
        const oldContent = content.slice()
        const newContent = removeAnn(content, annId)
        await setBlockContent(null, blockId, newContent)
        syncBlockContent(blockId, newContent)
        refreshDocCacheByBlock(blockId)
        return { ret: null, undoArgs: { blockId, oldContent } }
      },
      async (_panelId: string, undoArgs: { blockId: DbId; oldContent: ContentFragment[] }) => {
        if (undoArgs == null) return
        await setBlockContent(null, undoArgs.blockId, undoArgs.oldContent)
        syncBlockContent(undoArgs.blockId, undoArgs.oldContent)
        refreshDocCacheByBlock(undoArgs.blockId)
      },
      { label: t("Delete annotation"), hasArgs: true, noFocusNeeded: true },
    )
  }
}

/**
 * 调用批注命令：优先走编辑器命令（进入撤销栈），失败时退回普通命令。
 * 供批注卡/下拉卡等编辑器外部的 UI 调用。
 */
export async function invokeAnnCommand(id: string, ...args: any[]): Promise<any> {
  try {
    return await orca.commands.invokeEditorCommand(id, null, ...args)
  } catch {
    return await orca.commands.invokeCommand(id, ...args)
  }
}

/** 反注册批注命令 */
export function unregisterCommands(pluginName: string) {
  const ids = [
    `${pluginName}.ann.add`,
    `${pluginName}.ann.edit`,
    `${pluginName}.ann.remove`,
  ]
  for (const id of ids) {
    try {
      orca.commands.unregisterCommand(id)
    } catch {
      /* ignore */
    }
    try {
      orca.commands.unregisterEditorCommand(id)
    } catch {
      /* ignore */
    }
  }
}
