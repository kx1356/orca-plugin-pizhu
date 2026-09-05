// 批注命令：选区添加、编辑、删除、打开汇总面板
import type { Block, ContentFragment, DbId } from "./orca.d.ts"
import {
  ANN_TYPE,
  genAnnId,
  isAnn,
  removeAnn,
  replaceRange,
  updateAnn,
  extractRange,
  getActiveRootBlockId,
  findViewPanelByView,
  type AnnFragment,
} from "./ann"
import { openAnnCard } from "./store"

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

/** 弹出批注输入（自绘 DOM 浮层，Promise 化），返回 null 表示取消 */
function promptNote(initial: string, text: string): Promise<string | null> {
  return new Promise((resolve) => {
    const mask = document.createElement("div")
    mask.className = "pizhu-prompt-mask"

    const card = document.createElement("div")
    card.className = "pizhu-prompt-card"

    const label = document.createElement("div")
    label.className = "pizhu-prompt-label"
    label.textContent = `批注：${text.slice(0, 30)}${text.length > 30 ? "…" : ""}`

    const input = document.createElement("textarea")
    input.className = "pizhu-prompt-input"
    input.rows = 4
    input.placeholder = "写下你的想法…"

    const actions = document.createElement("div")
    actions.className = "pizhu-prompt-actions"

    const cancelBtn = document.createElement("button")
    cancelBtn.type = "button"
    cancelBtn.className = "pizhu-prompt-btn pizhu-prompt-cancel"
    cancelBtn.textContent = "取消"

    const okBtn = document.createElement("button")
    okBtn.type = "button"
    okBtn.className = "pizhu-prompt-btn pizhu-prompt-ok"
    okBtn.textContent = "确定"

    actions.append(cancelBtn, okBtn)
    card.append(label, input, actions)
    mask.appendChild(card)
    document.body.appendChild(mask)

    input.value = initial

    const done = (value: string | null) => {
      mask.remove()
      resolve(value)
    }
    const ok = () => done(input.value.trim() || null)

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
      async ([panelId, rootBlockId, cursor]): Promise<any> => {
        if (cursor == null) {
          orca.notify("warn", "请先选中要批注的文字")
          return null
        }
        const { anchor, focus } = cursor
        if (anchor.blockId !== focus.blockId) {
          orca.notify("warn", "暂不支持跨块批注，请在一个块内选中文字")
          return null
        }
        const blockId = anchor.blockId as DbId
        const block = orca.state.blocks[blockId] as Block | undefined
        if (block == null) return null

        const content = block.content ?? []
        const [start, end] = cursor.isForward ? [anchor, focus] : [focus, anchor]

        const { fragments, text } = extractRange(content, start, end)
        if (!text) {
          orca.notify("warn", "没有选中文字")
          return null
        }

        // 捕获选中文字的实际样式（字号等）。必须在弹输入框之前：
        // 浮层弹出会抢走选区，之后再读 getSelection 只能拿到默认样式。
        const domStyle = captureSelectionStyle()

        const note = await promptNote("", text)
        if (note == null) return null // 用户取消

        const ann: AnnFragment = {
          t: ANN_TYPE,
          v: text,
          id: genAnnId(),
          note,
          texts: fragments,
          created: Date.now(),
          ...(domStyle ? { domStyle } : {}),
        }
        const newContent = replaceRange(content, start, end, ann)
        await setBlockContent(cursor, blockId, newContent)

        // 返回撤销数据：恢复旧 content
        return { ret: null, undoArgs: { blockId, oldContent: content } }
      },
      async (panelId: string, undoArgs: { blockId: DbId; oldContent: ContentFragment[] }) => {
        if (undoArgs) {
          await setBlockContent(null, undoArgs.blockId, undoArgs.oldContent)
        }
      },
      { label: "添加批注" },
    )
  }

  // ============ 编辑批注 ============
  const editCmd = `${pluginName}.ann.edit`
  if (orca.state.commands[editCmd] == null) {
    orca.commands.registerCommand(
      editCmd,
      async (blockId: DbId, annId: string, note: string) => {
        const block = orca.state.blocks[blockId] as Block | undefined
        if (block == null) return
        const content = block.content ?? []
        if (findAnn(content, annId) == null) return
        const newContent = updateAnn(content, annId, { note, modified: Date.now() })
        await setBlockContent(null, blockId, newContent)
      },
      "编辑批注",
    )
  }

  // ============ 删除批注 ============
  const removeCmd = `${pluginName}.ann.remove`
  if (orca.state.commands[removeCmd] == null) {
    orca.commands.registerCommand(
      removeCmd,
      async (blockId: DbId, annId: string) => {
        const block = orca.state.blocks[blockId] as Block | undefined
        if (block == null) return
        const content = block.content ?? []
        if (findAnn(content, annId) == null) return
        const newContent = removeAnn(content, annId)
        await setBlockContent(null, blockId, newContent)
      },
      "删除批注",
    )
  }

  // ============ 打开汇总面板 ============
  const openCmd = `${pluginName}.openPanel`
  if (orca.state.commands[openCmd] == null) {
    orca.commands.registerCommand(
      openCmd,
      () => {
        const activePanelId = orca.state.activePanel
        if (!activePanelId) {
          orca.notify("warn", "没有可用的面板")
          return
        }
        // 已打开则复用，避免重复建面板
        let targetId: string | null = null
        const existing = findViewPanelByView("pizhu.panel", orca.state.panels)
        if (existing != null) {
          targetId = existing.id
        } else {
          const rootBlockId = getActiveRootBlockId()
          targetId = orca.nav.addTo(activePanelId, "right", {
            view: "pizhu.panel",
            viewArgs: { rootBlockId },
            viewState: {},
          })
        }
        if (targetId) {
          // addTo 创建后需显式导航设置视图，再切焦点
          orca.nav.goTo("pizhu.panel", {}, targetId)
          setTimeout(() => orca.nav.switchFocusTo(targetId), 80)
        } else {
          orca.notify("error", "无法创建批注面板")
        }
      },
      "打开批注面板",
    )
  }

  // ============ 查看当前块批注（备用入口） ============
  const viewCmd = `${pluginName}.viewBlockAnns`
  if (orca.state.commands[viewCmd] == null) {
    orca.commands.registerCommand(
      viewCmd,
      (blockId: DbId | undefined) => {
        const bid = blockId ?? getActiveRootBlockId()
        if (bid == null) return
        openAnnCard(bid, "", 0, 0) // 仅用于演示入口，实际以面板为主
      },
      "查看当前块批注",
    )
  }
}

/** 反注册批注命令 */
export function unregisterCommands(pluginName: string) {
  const ids = [
    `${pluginName}.ann.add`,
    `${pluginName}.ann.edit`,
    `${pluginName}.ann.remove`,
    `${pluginName}.openPanel`,
    `${pluginName}.viewBlockAnns`,
  ]
  for (const id of ids) {
    try {
      orca.commands.unregisterCommand(id)
    } catch {
      /* ignore */
    }
  }
  try {
    orca.commands.unregisterEditorCommand(`${pluginName}.ann.add`)
  } catch {
    /* ignore */
  }
}
