# orca-pizhu 批注插件

虎鲸笔记（Orca Note）批注插件：选中文字添加批注，波浪线 + 角标数字标记，点击查看/编辑，侧边面板汇总所有批注。

## 功能

- **添加批注**：选中文字，点工具栏「添加批注」按钮（气泡加号图标），输入批注内容确认
- **波浪线标记**：批注文字带琥珀色波浪线 + 角标数字（块内序号）
- **批注卡**：点击波浪线文字弹出批注卡，可编辑、删除
- **汇总面板**：工具栏「批注面板」按钮（笔记本图标）在右侧打开批注面板，列出当前文档所有批注，点击跳转到所在块

## 安装

1. 将本目录放入虎鲸笔记的 `plugins` 目录（Windows: `C:\Users\<你>\Documents\orca\plugins`）
2. 重启虎鲸笔记，在设置中启用插件

## 开发

```bash
npm install
npm run build   # 产物在 dist/index.js
```

批注数据全部存储在内联 fragment 中（`t: "pizhu.ann"`），跟随文本流，无独立数据文件，跨设备同步天然正确。删除批注时会还原原文格式（fragment 快照）。

## 技术要点

- 入口：`src/main.tsx` 导出 `load/unload`
- 渲染器：`src/renderer.tsx`（inline 渲染器 + 批注卡）
- 命令：`src/commands.ts`（选区替换算法在 `src/ann.ts`）
- 面板：`src/panel.tsx`（`orca.panels.registerPanel("pizhu.panel")`）
- 样式：`src/styles.ts`（`orca.themes.injectCSS` 注入）
