// 批注插件入口：注册渲染器、命令、面板、工具栏按钮、快捷键
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"
import AnnotationInline, { AnnotationCard, setPluginPrefix as setRendererPrefix } from "./renderer"
import { registerCommands, unregisterCommands } from "./commands"
import { findViewPanelByView } from "./ann"
import AnnPopupButton, { setPluginPrefix as setPopupPrefix } from "./popup"
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
}

/** 根据设置开关，启用/停用可选功能模块（开关在设置里可随时切换） */
function syncFeatureSwitches() {
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

  // 1. 行内渲染器：波浪线 + 角标
  orca.renderers.registerInline("pizhu.ann", false, AnnotationInline)

  // 2. 命令
  registerCommands(pluginName)

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
  unregisterCommands(pluginName)

  // 停用可选功能模块（页签栏 / 回收站）
  try {
    if (tabbarOn) {
      disableTabbar()
      tabbarOn = false
    }
  } catch {
    /* ignore */
  }
  try {
    if (trashbinOn) {
      disableTrashbin()
      trashbinOn = false
    }
  } catch {
    /* ignore */
  }
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
