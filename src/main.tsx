// 批注插件入口：注册渲染器、命令、工具栏按钮、顶栏按钮、快捷键
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"
import AnnotationInline, { AnnotationCard, AnnotationRefInline, setPluginPrefix as setRendererPrefix } from "./renderer"
import { registerCommands, unregisterCommands } from "./commands"
import { generateSummary } from "./summary"
import { findViewPanelByView } from "./ann"
import AnnPopupButton, { setPluginPrefix as setPopupPrefix } from "./popup"
import { setPluginPrefix as setCachePrefix } from "./annCache"
import { PIZHU_CSS } from "./styles"
import { enable as enableTabbar, disable as disableTabbar } from "./modules/tabbar"
import { enable as enableTrashbin, disable as disableTrashbin } from "./modules/trashbin"
import TABBAR_CSS from "./modules/tabbar.css?inline"
import TRASH_CSS from "./modules/trashbin.css?inline"

const { createRoot } = window as any

let pluginName: string
let cardRoot: any = null
let cardHost: HTMLDivElement | null = null
let tabbarOn = false
let trashbinOn = false
let settingsUnsub: any = null

/** 合并插件设置 schema：核心批注 + 页签栏/回收站可选项 */
const SCHEMA = {
  tabBarEnabled: {
    type: "boolean",
    label: "启用页签栏",
    description: "缓存编辑器页签条：点击切换、拖拽排序、拖到面板边缘分栏、垂直模式、固定页签。",
    defaultValue: true,
  },
  verticalTabs: {
    type: "boolean",
    label: "垂直页签",
    description: "页签竖排在编辑器左侧，拖动右边缘可调宽、双击复位。",
    defaultValue: false,
  },
  maxTabs: {
    type: "number",
    label: "每面板最大页签数",
    description: "每个面板保留的缓存页签上限，超出后按最近使用淘汰。",
    defaultValue: 5,
  },
  accentColor: {
    type: "color",
    label: "页签栏强调色",
    description: "页签高亮与拖拽提示的颜色；留空跟随 Orca 主题色。",
    defaultValue: "",
  },
  trashEnabled: {
    type: "boolean",
    label: "启用回收站",
    description: "删除页面自动存入回收站（普通搜索搜不到），可恢复或彻底删除。关闭则删除直接真删。",
    defaultValue: true,
  },
  trashRetentionDays: {
    type: "number",
    label: "回收站保留天数",
    description: "回收站中的页面快照超过该天数自动清除。默认 30 天。",
    defaultValue: 30,
  },
  popScope: {
    type: "singleChoice",
    label: "批注下拉卡范围",
    description: "顶栏批注下拉卡显示的范围：仅当前打开文档，或全部文档（按页面分组，当前文档排最前）。",
    defaultValue: "doc",
    choices: [
      { label: "仅当前文档", value: "doc" },
      { label: "全部文档", value: "all" },
    ],
  },
  annColor: {
    type: "color",
    label: "批注颜色",
    description: "批注波浪线与角标的默认颜色；留空跟随 Orca 主题强调色。单条批注可在批注卡内单独选色。",
    defaultValue: "",
  },
  annLineStyle: {
    type: "singleChoice",
    label: "批注线型",
    description: "批注波浪线下划线线型。",
    defaultValue: "wavy",
    choices: [
      { label: "波浪线", value: "wavy" },
      { label: "点线", value: "dotted" },
      { label: "实线", value: "solid" },
    ],
  },
  summaryAlias: {
    type: "string",
    label: "批注汇总页标题",
    description: "生成批注汇总页时使用的页面标题/别名；该页面由插件维护，刷新会重建其内容。",
    defaultValue: "批注汇总",
  },
}

/** 把批注颜色/线型设置写入 body CSS 变量 */
function applyAnnStyle() {
  const s = ((orca.state as any).plugins?.[pluginName]?.settings ?? {}) as any
  const body = document.body.style
  const color = typeof s.annColor === "string" && s.annColor.trim() ? s.annColor.trim() : ""
  if (color) body.setProperty("--pizhu-ann-color", color)
  else body.removeProperty("--pizhu-ann-color")
  const style = s.annLineStyle === "dotted" || s.annLineStyle === "solid" ? s.annLineStyle : "wavy"
  body.setProperty("--pizhu-ann-style", style)
}

/** 根据设置开关，启用/停用可选功能模块（开关在设置里可随时切换） */
function syncFeatureSwitches() {
  applyAnnStyle()
  const s = (orca.state as any).plugins?.[pluginName]?.settings ?? {}
  const wantTabbar = s.tabBarEnabled !== false
  const wantTrash = s.trashEnabled !== false
  if (wantTabbar && !tabbarOn) {
    enableTabbar(pluginName)
    tabbarOn = true
  } else if (!wantTabbar && tabbarOn) {
    disableTabbar()
    tabbarOn = false
  }
  if (wantTrash && !trashbinOn) {
    enableTrashbin(pluginName)
    trashbinOn = true
  } else if (!wantTrash && trashbinOn) {
    disableTrashbin()
    trashbinOn = false
  }
}

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  // 同步插件名前缀到渲染器/面板（命令 ID 依赖）
  setRendererPrefix(pluginName)
  setPopupPrefix(pluginName)
  setCachePrefix(pluginName)

  // 1. 行内渲染器：波浪线 + 角标；汇总页跳转芯片
  orca.renderers.registerInline("pizhu.ann", false, AnnotationInline)
  orca.renderers.registerInline("pizhu.ref", false, AnnotationRefInline)

  // 2. 命令
  registerCommands(pluginName)

  // 2a. 汇总页命令
  const summaryCmd = `${pluginName}.ann.summary`
  if (orca.state.commands[summaryCmd] == null) {
    orca.commands.registerCommand(
      summaryCmd,
      async () => {
        try {
          const { pageId, count } = await generateSummary(pluginName)
          orca.notify?.("success", t("Summary page updated (${count})", { count: String(count) }))
          orca.nav.goTo("block", { blockId: pageId })
        } catch (e: any) {
          orca.notify?.("error", `${t("Failed to generate summary")}: ${e?.message ?? e}`)
        }
      },
      "生成批注汇总页",
    )
  }

  // 2b. 清理旧版本遗留的 pizhu.panel 侧栏（v3.2.0 起改为顶栏下拉卡）
  try {
    const stale = findViewPanelByView("pizhu.panel", orca.state.panels)
    if (stale != null) orca.nav.close(stale.id)
  } catch {
    /* ignore */
  }

  // 3. 工具栏按钮：添加批注（编辑器命令，工具栏绑定 editor command 已验证）
  orca.toolbar.registerToolbarButton(`${pluginName}.ann.add`, {
    icon: "ti ti-message-circle-plus",
    tooltip: t("Add annotation"),
    command: `${pluginName}.ann.add`,
  })

  // 4. 顶栏按钮：批注下拉卡（Popup 锚定按钮，汇总当前文档批注，不占分栏空间）
  orca.headbar.registerHeadbarButton(`${pluginName}.annPopup`, () => (
    <AnnPopupButton />
  ))

  // 5. 注入样式（批注 + 页签栏 + 回收站）
  orca.themes.injectCSS(`${PIZHU_CSS}\n${TABBAR_CSS}\n${TRASH_CSS}`, pluginName)

  // 5a. 快捷键：Ctrl+Alt+A 快捷添加批注（editor command，编辑器会注入当前选区上下文）
  try {
    orca.shortcuts.assign("ctrl+alt+a", `${pluginName}.ann.add`)
  } catch {
    /* ignore */
  }

  // 5b. 设置 schema 与可选功能开关
  try {
    ;(orca.plugins as any).setSettingsSchema(pluginName, SCHEMA)
  } catch {
    /* ignore */
  }
  syncFeatureSwitches()
  try {
    const ps = (orca.state as any).plugins?.[pluginName]
    if (ps) settingsUnsub = (window as any).Valtio.subscribe(ps, syncFeatureSwitches)
  } catch {
    settingsUnsub = null
  }

  // 6. 挂载批注卡浮层
  cardHost = document.createElement("div")
  cardHost.id = "pizhu-card-host"
  document.body.appendChild(cardHost)
  cardRoot = createRoot(cardHost)
  cardRoot.render(<AnnotationCard />)

  console.log(`${pluginName} loaded.`)
}

export async function unload() {
  // 卸载浮层
  if (cardRoot != null) {
    try {
      cardRoot.unmount()
    } catch {
      /* ignore */
    }
  }
  if (cardHost != null) {
    cardHost.remove()
  }
  cardRoot = null
  cardHost = null

  // 反注册全部
  orca.renderers.unregisterInline("pizhu.ann")
  orca.renderers.unregisterInline("pizhu.ref")
  try {
    orca.commands.unregisterCommand(`${pluginName}.ann.summary`)
  } catch {
    /* ignore */
  }
  try {
    orca.toolbar.unregisterToolbarButton(`${pluginName}.ann.add`)
  } catch {
    /* ignore */
  }
  try {
    orca.headbar.unregisterHeadbarButton(`${pluginName}.annPopup`)
  } catch {
    /* ignore */
  }
  orca.themes.removeCSS(pluginName)
  try {
    orca.shortcuts.assign("", `${pluginName}.ann.add`)
  } catch {
    /* ignore */
  }
  unregisterCommands(pluginName)

  // 停用可选功能模块（页签栏 / 回收站）：无条件调用，确保即使开关状态失步也能清理干净
  try {
    disableTabbar()
  } catch {
    /* ignore */
  }
  tabbarOn = false
  try {
    disableTrashbin()
  } catch {
    /* ignore */
  }
  trashbinOn = false

  // 兜底清理可能残留的页签栏 DOM 状态
  const bodyStyle = document.body.style
  for (const prop of [
    "--orca-tabbar-left",
    "--orca-tabbar-right",
    "--orca-tabbar-top",
    "--orca-tabbar-bottom",
    "--orca-tabbar-w",
    "--orca-tabbar-accent",
    "--pizhu-ann-color",
    "--pizhu-ann-style",
  ]) {
    bodyStyle.removeProperty(prop)
  }
  document.body.classList.remove("orca-tabbar-on", "orca-tabbar-vertical")

  if (settingsUnsub) {
    try {
      settingsUnsub()
    } catch {
      /* ignore */
    }
    settingsUnsub = null
  }

  console.log(`${pluginName} unloaded.`)
}
