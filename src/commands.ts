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

/** 弹出批注输入（自绘 DOM 浮层，Promise 化），返回 null 表示取消 */
function promptNote(initial: string, text: string): Promise<string | null> {
  return new Promise((resolve) => {
    const mask = document.createElement("div")
    mask.className = "pizhu-prompt-mask"
    mask.innerHTML = `
      <div class="pizhu-prompt-card">
        <div class="pizhu-prompt-label">批注：${escapeHtml(
          text.slice(0, 30),
        )}${text.length > 30 ? "…" : ""}</div>
        <textarea class="pizhu-prompt-input" rows="4" placeholder="写下你的想法…"></textarea>
        <div class="pizhu-prompt-actions">
          <button class="pizhu-prompt-btn pizhu-prompt-cancel" type="button">取消</button>
          <button class="pizhu-prompt-btn pizhu-prompt-ok" type="button">确定</button>
        </div>
      </div>`
    document.body.appendChild(mask)

    const input = mask.querySelector(".pizhu-prompt-input") as HTMLTextAreaElement
    input.value = initial

    const done = (value: string | null) => {
      mask.remove()
      resolve(value)
    }
    const ok = () => done(input.value.trim() || null)

    mask
      .querySelector(".pizhu-prompt-ok")!
      .addEventListener("click", ok)
    mask
      .querySelector(".pizhu-prompt-cancel")!
      .addEventListener("click", () => done(null))
    mask.addEventListener("mousedown", (e) => {
      if (e.target === mask) done(null)
    })
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        ok()
      } else if (e.key === "Escape") {
        done(null)
      }
    })
    input.focus()
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
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

        const note = await promptNote("", text)
        if (note == null) return null // 用户取消

        const ann: AnnFragment = {
          t: ANN_TYPE,
          v: text,
          id: genAnnId(),
          note,
          texts: fragments,
          created: Date.now(),
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
