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

## 发布到虎鲸集市

集市从 [sethyuan/awesome-orcanote](https://github.com/sethyuan/awesome-orcanote) 的 `plugins.json` 拉取列表；发布 = 更新该文件并发 PR。前置：`gh` 已登录 `kx1356`，且已 fork 出 `kx1356/awesome-orcanote`。

1. 更新 `CHANGELOG.md`（顶部加新版本条目），并把 `package.json` 的 `version` 改为新版本（如 `3.4.2`）。
2. 提交并打标签（标签格式 `vX.Y.Z`）：
   ```powershell
   git add -A
   git commit -m "fix: ..."
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```
3. 构建 + 打包。zip 顶层目录为 `orca-pizhu/`，内含 `dist/index.js`、`package.json`、`LICENSE`、`README.md`、`icon.svg`：
   - 构建：`node_modules\.bin\vite.cmd build`（本机 PowerShell 执行策略会拦截 `npm.ps1`，不要直接用 `npm`）
   - 复制上述文件到 `release\orca-pizhu\` 后 `Compress-Archive` 成 `release\orca-pizhu-vX.Y.Z.zip`
   - 可选校验：`node scripts/validate-marketplace-package.mjs`（会打印要插入 `plugins.json` 的完整条目）
4. 创建 GitHub Release 并上传 zip：
   ```powershell
   gh release create vX.Y.Z "release\orca-pizhu-vX.Y.Z.zip" --repo kx1356/orca-plugin-pizhu --title "vX.Y.Z" --notes "..." --latest
   ```
5. 更新集市索引并提 PR：
   ```powershell
   git clone https://github.com/kx1356/awesome-orcanote.git <tmp>
   git -C <tmp> remote add upstream https://github.com/sethyuan/awesome-orcanote.git
   git -C <tmp> fetch upstream
   git -C <tmp> checkout -b update-orca-pizhu-vX.Y.Z upstream/main
   ```
   用脚本更新 `plugins.json` 中 `author=kx1356, id=orca-pizhu` 条目的 `description / version / updated / zip / translations / icon_svg`。
   `icon_svg` 必须用仓库自带脚本生成（单行、≤60x60）：`node scripts/minify-svg.js <path-to-icon.svg>`。
   ```powershell
   git -C <tmp> commit -am "bump orca-pizhu to vX.Y.Z"
   git -C <tmp> push -u origin update-orca-pizhu-vX.Y.Z
   gh pr create --repo sethyuan/awesome-orcanote --base main --head kx1356:update-orca-pizhu-vX.Y.Z --title "bump orca-pizhu to vX.Y.Z" --body "..."
   ```
6. PR 合并后，虎鲸应用内市场才会显示新版本。
7. 最后按「构建与部署」把新版本同步到本地插件目录。

## 说明

- `src/modules/tabbar.ts`、`src/modules/trashbin.ts` 为原 `@ts-nocheck` 模块，现已纳入 `strict` 类型检查，请保持无类型错误。
