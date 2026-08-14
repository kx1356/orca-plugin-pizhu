# 发布到虎鲸插件集市

虎鲸应用内插件市场从 [awesome-orcanote](https://github.com/sethyuan/awesome-orcanote) 仓库的 `plugins.json` 拉取插件列表。发布 = 让插件条目进入这个文件（PR 给 sethyuan）。

## 前置准备（已完成）

- `package.json`：含 `orcaNoteMarketplace` 字段（id / name / category / artifactName / translations.zh）
- `LICENSE`（MIT）
- `icon.png`（≤80x80）
- 校验脚本：`scripts/validate-marketplace-package.mjs`（从 task-planner 移植）
- 发布脚本：`scripts/release.ps1`（校验 → 构建 → 打包 zip）

## 发布步骤

1. **替换占位符**：把 `package.json`、`LICENSE` 中的 `pizhu-dev` 换成真实 GitHub 用户名
2. **校验 + 打包**：
   ```bash
   node scripts/validate-marketplace-package.mjs   # 校验
   powershell -File scripts/release.ps1 -DryRun    # 打包 release/orca-pizhu-v0.1.0.zip
   ```
3. **GitHub 仓库**：创建 `orca-plugin-pizhu` 仓库，推代码，打 tag：
   ```bash
   git tag v0.1.0 && git push origin v0.1.0
   ```
4. **创建 Release**：GitHub Releases 发布 `v0.1.0`，附件上传 `orca-pizhu-v0.1.0.zip`（zip 内目录结构：dist/index.js、package.json、LICENSE、README.md、icon.png）
5. **更新插件索引**：把校验脚本输出的 JSON 条目插入 awesome-orcanote 的 `plugins.json`（按 author、id 排序），PR 提交
6. 合并后，虎鲸应用内市场即可搜索安装

## 版本更新

改代码 → `npm version patch` → 重复步骤 2-5（新 tag + 新 zip + plugins.json 里 version/updated/zip 更新）。
