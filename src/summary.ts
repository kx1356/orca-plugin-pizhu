// 批注汇总页：把所有批注生成/刷新到一个 Orca 原生页面。
// 结构：页面 → 更新时间/说明 → 每个来源页面一个标题块 → 每条批注一个列表项
//（原文 + 批注内容 + 可点击跳转芯片 pizhu.ref）。除跳转芯片外均为原生块，可搜索/组织。
import type { DbId } from "./orca.d.ts"
import { collectAllGroups, mergeAllGroups, type AnnPageGroup } from "./collect"
import { ensureMemCache, getCachedPages } from "./annCache"
import { t } from "./libs/l10n"

type BackendFn = (name: string, ...args: any[]) => any

/** 直接调用后端（绕过回收站 hook 的 delete-blocks 拦截由 hook 自行透传非顶层块） */
function backend(): BackendFn {
  return (name: string, ...args: any[]) => (orca.invokeBackend as any)(name, ...args)
}

function extractId(result: any): DbId | null {
  if (result == null) return null
  if (Array.isArray(result)) {
    const first = result[0]
    return first && typeof first === "object" ? (first.id ?? first) : first
  }
  return typeof result === "object" ? (result.id ?? result) : result
}

/** 查找或创建汇总页（顶层页面 + 别名） */
async function getOrCreateSummaryPage(alias: string): Promise<DbId> {
  const b = backend()
  try {
    const existing = await b("get-blockid-by-alias", alias)
    if (existing != null) return existing as DbId
  } catch { /* 不存在则创建 */ }
  const created = await b(
    "create-block",
    undefined,
    null,
    null,
    null,
    { type: "text" },
    [{ t: "t", v: alias }],
    alias,
  )
  const id = extractId(created)
  if (id == null) throw new Error("create-block returned no id")
  try { await b("create-alias", alias, id, true, null) } catch { /* ignore */ }
  return id as DbId
}

/** 在页面末尾创建子块 */
async function createChild(
  b: BackendFn,
  parentId: DbId,
  leftId: DbId | null,
  repr: any,
  content: any[],
  text: string,
): Promise<DbId | null> {
  const created = await b("create-block", parentId, leftId, null, null, repr, content, text)
  return extractId(created)
}

/**
 * 生成/刷新批注汇总页。
 * @returns 页面 id 与批注条数
 */
export async function generateSummary(
  pluginName: string,
  aliasOverride?: string,
): Promise<{ pageId: DbId; count: number }> {
  const settings = ((orca.state as any).plugins?.[pluginName]?.settings ?? {}) as any
  const alias =
    (typeof aliasOverride === "string" && aliasOverride.trim()) ||
    (typeof settings.summaryAlias === "string" && settings.summaryAlias.trim()) ||
    "批注汇总"
  const b = backend()

  // 收集批注：内存实时 + 跨文档缓存
  await ensureMemCache().catch(() => { /* ignore */ })
  const blocks = (orca.state as any).blocks ?? {}
  const groups: AnnPageGroup[] = mergeAllGroups(
    collectAllGroups(blocks, undefined),
    getCachedPages(),
    undefined,
  )
  const count = groups.reduce((n, g) => n + g.entries.length, 0)

  const pageId = await getOrCreateSummaryPage(alias)

  // 清空现有子块后重建（汇总页由插件维护；子块非顶层页面，不会被回收站快照）
  try {
    const page: any = await b("get-block", pageId)
    const children = Array.isArray(page?.children) ? page.children : []
    if (children.length) await b("delete-blocks", children)
  } catch { /* ignore */ }

  let prev: DbId | null = null
  const headerText = t("Updated ${time} · ${count} annotations", {
    time: new Date().toLocaleString(),
    count: String(count),
  })
  prev = await createChild(b, pageId, prev, { type: "text" }, [{ t: "t", v: headerText }], headerText)
  const hint = t("Maintained automatically by Pizhu Toolbox; do not edit manually.")
  prev = await createChild(b, pageId, prev, { type: "text" }, [{ t: "t", v: hint }], hint)

  for (const g of groups) {
    prev = await createChild(b, pageId, prev, { type: "heading", level: 2 }, [{ t: "t", v: g.title }], g.title)
    for (const e of g.entries) {
      const content: any[] = [
        { t: "t", v: `“${e.v}”` },
        { t: "t", v: " — " },
        { t: "t", v: e.note || "" },
        { t: "t", v: " " },
        { t: "pizhu.ref", v: e.blockId, color: e.color, ordinal: e.ordinal },
      ]
      const text = `“${e.v}” — ${e.note || ""}`
      prev = await createChild(b, pageId, prev, { type: "ul" }, content, text)
    }
  }

  return { pageId, count }
}
