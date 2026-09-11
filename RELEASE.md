# 发布到虎鲸插件集市

虎鲸应用内插件市场从 [awesome-orcanote](https://github.com/sethyuan/awesome-orcanote) 仓库的 `plugins.json` 拉取插件列表。发布 = 让插件条目更新并合入这个文件（PR 给 sethyuan）。

## 前置准备（已完成）

- `package.json`：含 `orcaNoteMarketplace` 字段（id / name / category / artifactName / translations.zh）
- `LICENSE`（MIT）
- `icon.svg`（≤60x60；集市要求 SVG 或 PNG）
- 校验脚本：`scripts/validate-marketplace-package.mjs`
- 发布脚本：`scripts/release.ps1`（校验 → 类型检查 + 构建 → 版本递增 → 打包 zip → 推送分支/标签 → `gh release create`）

> 本机 PowerShell 执行策略会拦截 `npm.ps1`，脚本内统一用 `*.cmd` / 本地 `node_modules\.bin\*`。

## 发布步骤

1. **准备本次改动**：更新 `CHANGELOG.md`，提交所有改动（`release.ps1` 要求工作区干净）。
2. **一键发布**（默认 patch 递增）：
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release.ps1
   ```
   该脚本会依次：校验元数据 → `tsc` + `vite build` → `npm version patch`（提交 + 打标签 `vX.Y.Z`）→ 打包 `release/orca-pizhu-vX.Y.Z.zip` → 推送 `main` 与标签 → `gh release create` 上传 zip。
   仅本地校验/打包（不动 git、不发版）：加 `-DryRun`（可配 `-SkipBuild`）。
3. **更新集市索引并提 PR**：
   - 从 `sethyuan/awesome-orcanote` 的 `main` 建分支（不要用 `kx1356/awesome-orcanote` 的 main，它可能过时）。
   - 更新 `plugins.json` 中 `author=kx1356, id=orca-pizhu` 条目的 `description / version / updated / zip / translations / icon_svg`。
   - `icon_svg` 必须用仓库自带脚本生成（单行、≤60x60）：`node scripts/minify-svg.js <path-to-icon.svg>`。
   - 提交并推送分支，`gh pr create --repo sethyuan/awesome-orcanote`。
4. **合并后**，虎鲸应用内市场即可看到新版本。
5. 最后把新版本同步到本地插件目录（见 `AGENTS.md` 的「构建与部署」）。

## 版本更新

改代码 → 更新 CHANGELOG 并提交 → `scripts/release.ps1` → 更新 `plugins.json` 并发 PR。版本号由 `npm version` 自动递增。
