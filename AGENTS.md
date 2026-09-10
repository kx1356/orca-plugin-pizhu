# AGENTS.md

## 构建与部署

- 类型检查：`node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json`
- 构建：`npm run build`（`tsc && vite build`，产物 `dist/index.js`）
- **每次改完代码后，务必同步部署**：
  ```powershell
  Copy-Item -LiteralPath "dist\index.js" -Destination "C:\Users\i5156\Documents\orca\plugins\orca-pizhu\dist\index.js" -Force
  ```
  或直接运行 `deploy.bat`。
- 部署后需彻底退出并重开虎鲸笔记才会生效。

## 说明

- `src/modules/tabbar.ts`、`src/modules/trashbin.ts` 为原 `@ts-nocheck` 模块，现已纳入 `strict` 类型检查，请保持无类型错误。
