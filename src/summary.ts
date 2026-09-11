// 批注汇总页：把所有批注生成/刷新到一个 Orca 原生页面。
// 方案 A「嵌套大纲」：头部信息 → 每个来源页面一个列表项 → 其下缩进嵌套该页每条批注。
//   条目内容形如： “原文” — 批注内容  ↗（点击跳转到原块）
// 全程使用官方编辑器命令（core.editor.*）；用「上一个块之后」链式插入保证顺序稳定。
import type { Block, DbId } from "./orca.d.ts"
import { collectAllGroups, mergeAllGroups, type AnnPageGroup } from "./collect"
import { ensureMemCache, getCachedPages } from "./annCache"
import { t } from "./libs/l10n"

/** 调用编辑器命令（cursor 固定为 null） */
function ed(id: string, ...args: any[]): Promise<any> {
  return (orca.commands as any).invokeEditorCommand(id, null, ...args)
}

/** 返回结果的块 id（insertBlock 返回 id 或含 id 的对象） */
function newId(result: any): DbId | null {
  if (result == null) return null
  if (typeof result === "object") return (result.id ?? null) as DbId | null
  return result as DbId
}

/** 规整块对象：补齐可能缺失的数组字段，避免编辑器命令内部迭代 undefined 报错 */
function normalizeBlock(b: any): Block | null {
  if (b == null) return null
  return {
    ...b,
    children: Array.isArray(b.children) ? b.children : [],
    aliases: Array.isArray(b.aliases) ? b.aliases : [],
    properties: Array.isArray(b.properties) ? b.properties : [],
    refs: Array.isArray(b.refs) ? b.refs : [],
    backRefs: Array.isArray(b.backRefs) ? b.backRefs : [],
  } as Block
}

/** 取块对象：优先内存，其次后端；统一规整 */
async function blockById(id: DbId): Promise<Block | null> {
  const live = (orca.state as any).blocks?.[id]
  if (live != null) return normalizeBlock(live)
  try {
    return normalizeBlock(await orca.invokeBackend("get-block" as any, id))
  } catch {
    return null
  }
}

/** 按别名取整块对象（后端查询，与是否加载无关） */
async function findPageByAlias(alias: string): Promise<Block | null> {
  try {
    return normalizeBlock(await orca.invokeBackend("get-block-by-alias" as any, alias))
  } catch {
    return null
  }
}

/** 查找或创建汇总页（顶层页面 + 别名），返回块对象 */
async function getOrCreateSummaryPage(alias: string): Promise<Block> {
  const existing = await findPageByAlias(alias)
  if (existing != null) return existing
  try {
    await orca.commands.invokeGroup(async () => {
      const id = await ed("core.editor.insertBlock", null, null, [{ t: "t", v: alias }])
      if (id == null) throw new Error("insertBlock returned no id")
      await ed("core.editor.createAlias", alias, id)
    })
  } catch { /* 回读确认，失败再抛 */ }
  const created = await findPageByAlias(alias)
  if (created == null) throw new Error(t("Failed to create summary page: ${name}", { name: alias }))
  return created
}

/** 在指定父块末尾追加一个子块，返回新块对象 */
async function appendChild(parent: Block, content: any[], repr: any): Promise<Block | null> {
  const id = newId(await ed("core.editor.insertBlock", parent, "lastChild", content, repr))
  return id == null ? null : blockById(id)
}

/** 在上一个块「之后」插入（sibling），保证顺序；last 为空则作为 parent 的末子块 */
async function appendAfter(
  parent: Block,
  last: Block | null,
  content: any[],
  repr: any,
): Promise<Block | null> {
  const ref = last ?? parent
  const pos = last ? "after" : "lastChild"
  const id = newId(await ed("core.editor.insertBlock", ref, pos, content, repr))
  return id == null ? null : blockById(id)
}

/**
 * 批注条目内容：  “原文” ｜ 批注内容  ↗（跳转芯片）
 * 原文带波浪线样式由芯片外的普通文本呈现；跳转芯片点击跳到被批注的块。
 */
function entryContent(e: AnnPageGroup["entries"][number]): any[] {
  const out: any[] = [{ t: "t", v: `“${e.v}”` }]
  if (e.note) {
    out.push({ t: "t", v: "  ｜  " })
    out.push({ t: "t", v: e.note })
  }
  out.push({ t: "t", v: " " })
  out.push({ t: "pizhu.ref", v: e.blockId, color: e.color })
  return out
}

/**
 * 生成/刷新批注汇总页（内部实现）。首次创建页面后块可能尚未完全就绪，
 * 因此外部 generateSummary 会在失败时延迟重试一次。
 */
async function runGenerate(
  pluginName: string,
  aliasOverride?: string,
): Promise<{ pageId: DbId; count: number }> {
  const settings = ((orca.state as any).plugins?.[pluginName]?.settings ?? {}) as any
  const alias =
    (typeof aliasOverride === "string" && aliasOverride.trim()) ||
    (typeof settings.summaryAlias === "string" && settings.summaryAlias.trim()) ||
    "批注汇总"

  // 收集批注：内存实时 + 跨文档缓存
  await ensureMemCache().catch(() => { /* ignore */ })
  const blocks = (orca.state as any).blocks ?? {}
  const groups: AnnPageGroup[] = mergeAllGroups(
    collectAllGroups(blocks, undefined),
    getCachedPages(),
    undefined,
  )
  const count = groups.reduce((n, g) => n + g.entries.length, 0)

  const pageBlock = await getOrCreateSummaryPage(alias)
  const pageId = pageBlock.id

  // 清空现有子块后重建（汇总页由插件维护）
  const children = Array.isArray(pageBlock.children) ? pageBlock.children.slice() : []
  if (children.length > 0) {
    try { await ed("core.editor.deleteBlocks", children) } catch { /* ignore */ }
  }

  // 顶部信息（单个块，置顶）
  const headerText = t("${count} annotations · Updated ${time} · maintained automatically, do not edit", {
    count: String(count),
    time: new Date().toLocaleString(),
  })
  let lastTop: Block | null = await appendChild(pageBlock, [{ t: "t", v: headerText }], { type: "text" })

  // 每个来源页面一个列表项（标题加粗 + 跳转芯片），其下嵌套该页批注
  for (const g of groups) {
    const pageContent: any[] = [
      { t: "t", v: g.title, f: "b" },
      { t: "t", v: " " },
      { t: "pizhu.ref", v: g.rootId },
    ]
    const pageItem = await appendAfter(pageBlock, lastTop, pageContent, { type: "ul" })
    lastTop = pageItem
    if (pageItem == null) continue

    let lastEntry: Block | null = null
    for (const e of g.entries) {
      lastEntry = await appendAfter(pageItem, lastEntry, entryContent(e), { type: "ul" })
    }
  }

  return { pageId, count }
}

/**
 * 生成/刷新批注汇总页。
 * 首次创建页面后，新建块可能尚未在编辑器中完全就绪，导致首跑失败；
 * 这里在失败时等待片刻再重试一次（等价于用户点第二次）。
 * @returns 页面 id 与批注条数
 */
export async function generateSummary(
  pluginName: string,
  aliasOverride?: string,
): Promise<{ pageId: DbId; count: number }> {
  try {
    return await runGenerate(pluginName, aliasOverride)
  } catch (firstError) {
    await new Promise((resolve) => setTimeout(resolve, 300))
    try {
      return await runGenerate(pluginName, aliasOverride)
    } catch {
      throw firstError
    }
  }
}
