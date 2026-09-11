# AGENTS.md

## 构建与部署

- 类型检查：`node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json`（加 `--noUnusedLocals --noUnusedParameters` 可查死代码）
- 构建：`node_modules\.bin\vite.cmd build`（等价于 `npm run build`，产物 `dist/index.js`；本机不要直接用 `npm`，会被执行策略拦截）
- **每次改完代码后，务必同步部署**：
  ```powershell
  Copy-Item -LiteralPath "dist\index.js" -Destination "C:\Users\i5156\Documents\orca\plugins\orca-pizhu\dist\index.js" -Force
  ```
  或直接运行 `deploy.bat`。
- 部署后需彻底退出并重开虎鲸笔记才会生效。

## 发布到虎鲸集市

> **⚠️ 不要自动发布。** 除非用户明确下达发布指令，否则不要执行 commit/push、打 tag、创建 GitHub Release、或向 awesome-orcanote 提 PR。默认只做「类型检查 → 构建 → 本地部署」，改动留在工作区等待指令。
>
> **⚠️ 集市只保留一个 PR。** 同一时间只维护一个 awesome-orcanote PR：后续更新复用同一个分支，把新 commit push 上去（PR 会自动更新），**不要新建 PR**。只有当该 PR 已被合并、才需要为下一次发布新建。当前分支：`update-orca-pizhu-3.6.0`（PR #180）。

集市从 [sethyuan/awesome-orcanote](https://github.com/sethyuan/awesome-orcanote) 的 `plugins.json` 拉取列表；发布 = 更新该文件并发 PR。完整步骤见 `RELEASE.md`。前置：`gh` 已登录 `kx1356`。

1. 更新 `CHANGELOG.md` 并**提交所有改动**（脚本要求工作区干净）。
2. 一键发布（校验 → 构建 → 版本递增 → 打包 → 推送 → 建 Release）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1
   ```
   仅本地校验/打包用 `-DryRun`（可加 `-SkipBuild`）。
3. 更新集市索引并提 PR（从 `upstream/main` 建分支，更新 `plugins.json` 中 `author=kx1356,id=orca-pizhu` 条目，`icon_svg` 用 `node scripts/minify-svg.js <icon.svg>` 生成）→ `gh pr create --repo sethyuan/awesome-orcanote`。
4. PR 合并后市场才更新；最后按「构建与部署」同步本地插件目录。

## 说明

- `src/modules/tabbar.ts`、`src/modules/trashbin.ts` 为原 `@ts-nocheck` 模块，现已纳入 `strict` 类型检查，请保持无类型错误。
