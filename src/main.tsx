// 批注插件入口：注册渲染器、命令、面板、工具栏按钮、快捷键
import { setupL10N, t } from "./libs/l10n"
import zhCN from "./translations/zhCN"
import AnnotationInline, { AnnotationCard, setPluginPrefix as setRendererPrefix } from "./renderer"
import { registerCommands, unregisterCommands } from "./commands"
import PizhuPanel, { setPluginPrefix as setPanelPrefix } from "./panel"
import { PIZHU_CSS } from "./styles"

const { createRoot } = window as any

let pluginName: string
let cardRoot: any = null
let cardHost: HTMLDivElement | null = null

export async function load(_name: string) {
  pluginName = _name

  setupL10N(orca.state.locale, { "zh-CN": zhCN })

  // 同步插件名前缀到渲染器/面板（命令 ID 依赖）
  setRendererPrefix(pluginName)
  setPanelPrefix(pluginName)

  // 1. 行内渲染器：波浪线 + 角标
  orca.renderers.registerInline("pizhu.ann", false, AnnotationInline)

  // 2. 命令
  registerCommands(pluginName)

  // 3. 汇总面板
  orca.panels.registerPanel("pizhu.panel", PizhuPanel)

  // 4. 工具栏按钮：添加批注（编辑器命令，工具栏绑定 editor command 已验证）
  orca.toolbar.registerToolbarButton(`${pluginName}.ann.add`, {
    icon: "ti ti-message-circle-plus",
    tooltip: t("Add annotation"),
    command: `${pluginName}.ann.add`,
  })

  // 5. 顶栏按钮：打开批注面板（普通命令，headbar 模式与 mcard 一致）
  const { Button } = orca.components as any
  orca.headbar.registerHeadbarButton(`${pluginName}.openPanel`, () => (
    <Button
      variant="plain"
      onClick={() => orca.commands.invokeCommand(`${pluginName}.openPanel`)}
      title={t("Open annotation panel")}
    >
      <span className="pizhu-headbar-btn">
        <i className="ti ti-notes" /> 批注
      </span>
    </Button>
  ))

  // 6. 注入样式
  orca.themes.injectCSS(PIZHU_CSS, pluginName)

  // 7. 挂载批注卡浮层
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
  orca.panels.unregisterPanel("pizhu.panel")
  try {
    orca.toolbar.unregisterToolbarButton(`${pluginName}.ann.add`)
  } catch {
    /* ignore */
  }
  try {
    orca.headbar.unregisterHeadbarButton(`${pluginName}.openPanel`)
  } catch {
    /* ignore */
  }
  orca.themes.removeCSS(pluginName)
  unregisterCommands(pluginName)

  console.log(`${pluginName} unloaded.`)
}
