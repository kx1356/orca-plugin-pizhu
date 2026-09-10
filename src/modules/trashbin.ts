// ============================================================
// Orca Trash Bin — 回收站
// 提炼自 orca-neo 主题 v2.0.0
// 拦截删除操作，自动保存页面快照，可随时恢复或彻底删除
// ============================================================

let pluginName = "";

/** invokeBackend 的签名（透传/拦截共用） */
type BackendFn = (name: string, ...args: any[]) => any;

// ---- 后端 hook（链式安全：卸载时只摘自己的 wrapper，不覆盖其他插件后装的 hook）----
let hookPrev: BackendFn | null = null;     // 安装 hook 前的 invokeBackend 原引用（即链上前一层）
let hookSelf: BackendFn | null = null;     // 本模块的 wrapper，用于识别自己是否在链顶
let hookActive = false;  // wrapper 是否执行拦截（即使被外层插件包裹，也能立即停用）
let cleanupTimer: ReturnType<typeof setInterval> | null = null; // 过期清理定时器

// ---- React 全局 ----
let React: any = null;
let ReactDOM: any = null;

// ============================================================
// 设置
// ============================================================

function settings() {
  return orca.state.plugins?.[pluginName]?.settings ?? {};
}

function trashEnabled() {
  return settings().trashEnabled !== false;
}

function retentionDays() {
  const n = Number(settings().trashRetentionDays);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

// ============================================================
// 后端访问与拦截
// ============================================================

function backend(): BackendFn {
  // 绕过自身拦截直接调用后端：优先用 hook 前的原函数，未安装 hook 时用当前函数
  return (name: string, ...args: any[]) => (hookPrev || orca.invokeBackend).call(orca, name, ...args);
}

// 拦截 invokeBackend 的 delete-blocks：删除前先把顶层块快照进回收站
function installHook() {
  hookActive = true;
  // 已在链顶则无需重复包装（重复启用场景）
  if (orca.invokeBackend === hookSelf) return;
  hookPrev = orca.invokeBackend;
  if (!hookSelf) {
    hookSelf = async (name: string, ...args: any[]) => {
      // 已停用或非删除命令：原样透传
      if (!hookActive || name !== "delete-blocks") {
        return (hookPrev as BackendFn).call(orca, name, ...args);
      }
      try {
        return await interceptDelete(args);
      } catch (e: any) {
        console.error("[TRASH] 拦截异常，已取消删除以保数据：", e);
        try {
          orca.notify?.("error", `回收站：删除已被拦截（${e?.message ?? e}），页面未删除以保数据。可重试或检查存储。`, { title: "回收站" });
        } catch { /* ignore */ }
        return [];
      }
    };
  }
  orca.invokeBackend = hookSelf;
}

function uninstallHook() {
  // 先停用拦截（即使 wrapper 被其他插件包裹在链里，也不再拦截）
  hookActive = false;
  // 仅当自己是链顶时才恢复原引用，避免覆盖其他插件后装的 hook
  if (hookSelf && orca.invokeBackend === hookSelf) {
    orca.invokeBackend = hookPrev as BackendFn;
    hookPrev = null;
    hookSelf = null;
  }
  // 非链顶：wrapper 保留但已透传，待外层插件卸载后链条自然断开
}

async function interceptDelete(args: any[]) {
  const b = backend();
  if (!trashEnabled()) return b("delete-blocks", ...args);
  const ids = Array.isArray(args[0]) ? args[0] : [];
  const repo = orca.state.repo;
  // 阶段一：只读取回所有顶层页面块快照，全部成功才继续（避免部分快照写入后删除被中止的“幽灵快照”）
  const pages: any[] = [];
  try {
    for (const id of ids) {
      let block: any = null;
      try { block = await b("get-block", id); } catch { block = null; }
      // 只快照顶层块（无父块 = 页面）；非顶层块直接随删除，不做快照
      if (block && (block.parent == null || block.parent === undefined || block.parent === "")) {
        const tree = (await snapshotTree(b, id)) ?? block;
        pages.push({ pageId: id, block, tree });
      }
    }
  } catch (e: any) {
    console.error("[TRASH] 快照阶段失败，已取消删除：", e);
    try { orca.notify?.("error", `回收站：读取快照失败，页面未删除（${e?.message ?? e}）`, { title: "回收站" }); } catch { /* ignore */ }
    return [];
  }
  // 阶段二：全部快照就绪后才写入文件与索引；任一写失败则回滚已写文件并取消删除
  const writes: any[] = [];
  try {
    for (const p of pages) {
      const record = {
        pageId: p.pageId,
        deletedAt: Date.now(),
        originalParent: p.block?.parent ?? null,
        originalLeft: p.block?.left ?? null,
        tree: p.tree,
      };
      const file = `trash/${repo}/${p.pageId}.json`;
      await b("set-plugin-file", pluginName, file, JSON.stringify(record));
      writes.push({
        pageId: p.pageId,
        fileName: file,
        deletedAt: record.deletedAt,
        originalParent: record.originalParent,
        originalLeft: record.originalLeft,
        title: titleOf(p.tree),
      });
    }
    const list = await readIndex(b, repo);
    const merged = [...list];
    for (const w of writes) {
      const i = merged.findIndex((e: any) => e.pageId === w.pageId);
      if (i >= 0) merged[i] = w; else merged.push(w);
    }
    await writeIndex(b, repo, merged);
    for (const w of writes) {
      try { orca.notify?.("success", `已移入回收站：${w.title}`, { title: "回收站" }); } catch { /* ignore */ }
    }
  } catch (e: any) {
    for (const w of writes) { try { await b("remove-plugin-file", pluginName, w.fileName); } catch { /* ignore */ } }
    console.error("[TRASH] 快照写入失败，已回滚并取消删除：", e);
    try { orca.notify?.("error", `回收站：保存快照失败，页面未删除（${e?.message ?? e}）`, { title: "回收站" }); } catch { /* ignore */ }
    return [];
  }
  return b("delete-blocks", ...args);
}

// ============================================================
// 快照与索引
// ============================================================

// 递归快照块树
async function snapshotTree(b: BackendFn, blockId: any, seen = new Set<any>(), depth = 0): Promise<any> {
  if (seen.has(blockId) || depth > 500) return null;
  seen.add(blockId);
  let block: any = null;
  try { block = await b("get-block", blockId); } catch { block = null; }
  if (!block) return null;
  const kids: any[] = [];
  for (const childId of Array.isArray(block.children) ? block.children : []) {
    if (typeof childId === "number") {
      const kid = await snapshotTree(b, childId, seen, depth + 1);
      if (kid) kids.push(kid);
    }
  }
  return {
    id: block.id,
    text: typeof block.text === "string" ? block.text : "",
    content: Array.isArray(block.content) ? block.content : null, // 保存富文本（含批注 fragment），恢复时还原
    aliases: Array.isArray(block.aliases) ? block.aliases : [],
    properties: Array.isArray(block.properties) ? block.properties : [],
    kids
  };
}


function indexKey(repo: string) {
  return `trash-index:${repo}`;
}

async function readIndex(b: BackendFn, repo: string): Promise<any[]> {
  try {
    const v = await b("get-plugin-data", pluginName, indexKey(repo));
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    }
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

async function writeIndex(b: BackendFn, repo: string, list: any[]): Promise<void> {
  await b("set-plugin-data", pluginName, indexKey(repo), JSON.stringify(list));
}

// ============================================================
// 列表 / 恢复 / 删除
// ============================================================

async function trashList() {
  const b = backend();
  const repo = orca.state.repo;
  const list = await readIndex(b, repo);
  const ttl = retentionDays() * 864e5;
  const now = Date.now();
  return list.map((e: any) => ({
    ...e,
    remainingMs: Math.max(0, e.deletedAt + ttl - now)
  }));
}

async function trashCount() {
  return trashList().then(l => l.length).catch(() => 0);
}

// 恢复：读快照 → 递归重建块 → 删除快照文件 → 更新索引
async function restorePage(pageId: any) {
  const b = backend();
  const repo = orca.state.repo;
  const file = `trash/${repo}/${pageId}.json`;
  let raw: any, record: any;
  try {
    raw = await b("get-plugin-file", pluginName, file);
    record = JSON.parse(String(raw ?? ""));
  } catch (e: any) {
    console.error("[TRASH] 读取快照失败：", e);
    try { orca.notify?.("error", `恢复失败：快照文件不可读（${e?.message ?? e}）`, { title: "回收站" }); } catch { /* ignore */ }
    return;
  }
  if (record == null || typeof record !== "object" || record.tree == null) {
    try { orca.notify?.("error", "恢复失败：快照内容损坏，请先彻底删除该条目", { title: "回收站" }); } catch { /* ignore */ }
    return;
  }
  await rebuildTree(b, record.tree, record.originalParent ?? null, record.originalLeft ?? null);
  try { await b("remove-plugin-file", pluginName, file); } catch { /* ignore */ }
  const list = await readIndex(b, repo);
  await writeIndex(b, repo, list.filter((e: any) => e.pageId !== pageId));
  try {
    orca.notify?.("success", `已恢复：${record?.tree ? titleOf(record.tree) : pageId}`, { title: "回收站" });
  } catch { /* ignore */ }
}

// 递归重建块树，返回创建出的块 id
async function rebuildTree(b: BackendFn, node: any, parentId: any, leftId: any): Promise<any> {
  if (node == null) return null;
  const { repr, content } = splitRepr(node);
  const text = typeof node?.text === "string" ? node.text : "";
  let createdId: any;
  try {
    createdId = await b("create-block", parentId, leftId, null, null, repr, content, text);
  } catch (e: any) {
    if (parentId == null) createdId = await b("create-block", undefined, leftId, null, null, repr, content, text);
    else throw e;
  }
  const id = extractId(createdId);
  // 页面级块补建别名
  if (parentId == null && id != null) {
    const alias = (Array.isArray(node?.aliases) && node.aliases.length > 0 && node.aliases[0])
      || (typeof node?.text === "string" ? node.text.trim() : "");
    if (alias && !String(alias).startsWith("_")) {
      try { await b("create-alias", alias, id, true, null); }
      catch (t: any) { console.warn("[TRASH] 恢复页面别名失败：", t); }
    }
  }
  let prev = null;
  for (const kid of node.kids ?? []) {
    const kidId = await rebuildTree(b, kid, id, prev);
    if (kidId != null) prev = kidId;
  }
  return id;
}

function extractId(result: any) {
  if (result == null) return null;
  if (Array.isArray(result)) {
    const first = result[0];
    return first && typeof first === "object" ? first.id ?? first : first;
  }
  return typeof result === "object" ? result.id ?? result : result;
}

// 从快照节点拆出 repr 与富文本内容
function splitRepr(node: any) {
  const reprProp = Array.isArray(node?.properties)
    ? node.properties.find((p: any) => p && p.name === "_repr")
    : null;
  const repr = reprProp && reprProp.value ? reprProp.value : { type: "text" };
  const text = (typeof node?.text === "string" ? node.text : "").replace(/\n+$/, "");
  // 优先还原快照内的富文本 content（保留批注/加粗/链接等），缺失时退回纯文本
  const content = Array.isArray(node?.content) && node.content.length > 0
    ? node.content
    : (text ? [{ t: "t", v: text }] : []);
  return { repr, content };
}

// 彻底删除单个
async function purgePage(pageId: any) {
  const b = backend();
  const repo = orca.state.repo;
  const file = `trash/${repo}/${pageId}.json`;
  try { await b("remove-plugin-file", pluginName, file); } catch { /* ignore */ }
  const list = await readIndex(b, repo);
  await writeIndex(b, repo, list.filter((e: any) => e.pageId !== pageId));
}

// 清空回收站
async function purgeAll() {
  const b = backend();
  const repo = orca.state.repo;
  const list = await readIndex(b, repo);
  for (const e of list) {
    try { await b("remove-plugin-file", pluginName, e.fileName); } catch { /* ignore */ }
  }
  await writeIndex(b, repo, []);
}

// 清理过期快照
async function purgeExpired() {
  const b = backend();
  const repo = orca.state.repo;
  const ttl = retentionDays() * 864e5;
  const now = Date.now();
  const list = await readIndex(b, repo);
  const keep: any[] = [];
  for (const e of list) {
    if (now - e.deletedAt > ttl) {
      try { await b("remove-plugin-file", pluginName, e.fileName); } catch { /* ignore */ }
    } else {
      keep.push(e);
    }
  }
  if (keep.length !== list.length) await writeIndex(b, repo, keep);
}

// ============================================================
// 定时清理
// ============================================================

function startCleanupTimer() {
  stopCleanupTimer();
  cleanupTimer = setInterval(() => {
    purgeExpired().catch(() => { /* ignore */ });
  }, 30 * 60 * 1000);
}

function stopCleanupTimer() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// ============================================================
// 标题工具
// ============================================================

function titleOf(node: any) {
  if (!node) return "(无标题)";
  const t = firstText(node);
  return t ? t.slice(0, 80) : "(无标题)";
}

function firstText(node: any): string {
  if (!node) return "";
  if (Array.isArray(node.content)) {
    for (const c of node.content) {
      if (c && typeof c.v === "string" && c.t === "t" && c.v.trim()) return c.v.trim();
    }
  }
  if (typeof node.text === "string" && node.text.trim()) return node.text.trim();
  if (Array.isArray(node.kids)) {
    for (const k of node.kids) {
      const t = firstText(k);
      if (t) return t;
    }
  }
  if (Array.isArray(node.children)) {
    for (const k of node.children) {
      const t = firstText(k);
      if (t) return t;
    }
  }
  return "";
}

// ============================================================
// UI：回收站浮层
// ============================================================

function ensureGlobals() {
  if (React) return;
  React = window.React;
  ReactDOM = window.ReactDOM;
}

function formatTime(ts: any) {
  try {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ""; }
}

function remainingText(ms: number) {
  const days = ms / 864e5;
  return days <= 0 ? "今天过期" : days < 1 ? "剩不到 1 天" : `剩 ${Math.ceil(days)} 天`;
}

function TrashDialog({ onClose }: any) {
  const [items, setItems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const refresh = React.useCallback(() => {
    trashList().then(setItems).catch(() => setItems([]));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function restore(id: any) {
    setBusy(true);
    try { await restorePage(id); refresh(); }
    catch (e: any) { orca.notify?.("error", `恢复失败：${e?.message ?? e}`, { title: "回收站" }); }
    finally { setBusy(false); }
  }
  async function purge(id: any) {
    setBusy(true);
    try { await purgePage(id); refresh(); }
    catch (e: any) { orca.notify?.("error", `删除失败：${e?.message ?? e}`, { title: "回收站" }); }
    finally { setBusy(false); }
  }
  async function purgeAllItems() {
    if (items.length !== 0 && window.confirm(`确定清空回收站？共 ${items.length} 项将被永久删除，不可恢复。`)) {
      setBusy(true);
      try { await purgeAll(); refresh(); }
      catch (e: any) { orca.notify?.("error", `清空失败：${e?.message ?? e}`, { title: "回收站" }); }
      finally { setBusy(false); }
    }
  }

  const [sort, setSort] = React.useState("deletedDesc");
  const sorted = React.useMemo(() => {
    const list = [...items];
    if (sort === "remainingAsc") list.sort((a, b) => a.remainingMs - b.remainingMs);
    else list.sort((a, b) => b.deletedAt - a.deletedAt);
    return list;
  }, [items, sort]);

  return React.createElement("div", { className: "orca-trash-backdrop", onMouseDown: onClose },
    React.createElement("div", { className: "orca-trash-pop", onMouseDown: (e: any) => e.stopPropagation() },
      React.createElement("div", { className: "orca-trash-head" },
        React.createElement("span", null, "回收站"),
        React.createElement("div", { className: "orca-trash-head-tools" },
          React.createElement("button", {
            className: "orca-trash-sort",
            title: "切换排序方式",
            onClick: () => setSort((s: string) => s === "deletedDesc" ? "remainingAsc" : "deletedDesc")
          }, sort === "deletedDesc" ? "删除时间倒序 ↓" : "剩余时长 ↑"),
          React.createElement("span", { className: "orca-trash-close", onClick: onClose }, "✕")
        )
      ),
      React.createElement("div", { className: "orca-trash-body" },
        sorted.length === 0 && React.createElement("div", { className: "orca-trash-empty" }, "回收站为空"),
        sorted.map((item: any) =>
          React.createElement("div", { className: "orca-trash-row", key: item.pageId },
            React.createElement("div", { className: "orca-trash-meta" },
              React.createElement("div", { className: "orca-trash-title", title: item.title }, item.title || "(无标题)"),
              React.createElement("div", { className: "orca-trash-sub" },
                formatTime(item.deletedAt), " · ", remainingText(item.remainingMs)
              )
            ),
            React.createElement("div", { className: "orca-trash-actions" },
              React.createElement("button", { className: "orca-trash-act", disabled: busy, onClick: () => restore(item.pageId) }, "恢复"),
              React.createElement("button", { className: "orca-trash-act danger", disabled: busy, onClick: () => purge(item.pageId) }, "彻底删除")
            )
          )
        )
      ),
      React.createElement("div", { className: "orca-trash-foot" },
        React.createElement("button", { className: "orca-trash-act danger", disabled: busy || sorted.length === 0, onClick: purgeAllItems }, "清空回收站")
      )
    )
  );
}

function openTrashDialog() {
  ensureGlobals();
  const host = document.createElement("div");
  document.body.appendChild(host);
  let closed = false;
  let root: any = null;
  const close = () => {
    if (closed) return;
    closed = true;
    try { root ? root.unmount() : ReactDOM.unmountComponentAtNode(host); } catch { /* ignore */ }
    host.remove();
  };
  try {
    const el = React.createElement(TrashDialog, { onClose: close });
    if (typeof ReactDOM.createRoot === "function") {
      root = ReactDOM.createRoot(host);
      root.render(el);
    } else {
      ReactDOM.render(el, host);
    }
  } catch (e: any) {
    console.error("[TRASH] 打开回收站浮层失败：", e);
    close();
  }
  return close;
}

// ============================================================
// UI：顶栏按钮（官方 registerHeadbarButton）
// ============================================================

function TrashButton() {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    const refresh = () => trashCount().then(c => { if (!dead) setCount(c); }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => { dead = true; clearInterval(timer); };
  }, []);
  return React.createElement(
    orca.components.Button,
    { variant: "plain", className: "orca-trash-headbar-btn", title: "回收站", "aria-label": "回收站", onClick: openTrashDialog },
    React.createElement("i", { className: "ti ti-trash orca-headbar-icon" }),
    count > 0 && React.createElement("span", { className: "orca-trash-menu-count" }, String(count))
  );
}

function registerHeadbarEntry() {
  try {
    ensureGlobals();
    orca.headbar.registerHeadbarButton(`${pluginName}.trash`, () => React.createElement(TrashButton));
  } catch (e) {
    console.error("[TRASH] 注册顶栏按钮失败：", e);
  }
}

function unregisterHeadbarEntry() {
  try {
    orca.headbar.unregisterHeadbarButton(`${pluginName}.trash`);
  } catch (e) {
    console.error("[TRASH] 注销顶栏按钮失败：", e);
  }
}

// ============================================================
// 设置 schema 与生命周期
// ============================================================

export async function enable(name: string) {
  pluginName = name;
  try {
    installHook();
    startCleanupTimer();
    await purgeExpired().catch(() => { /* ignore */ });
    registerHeadbarEntry();
    console.log(`${name} loaded.`);
  } catch (e: any) {
    console.error(`[TRASH] ${name} 加载失败：`, e);
    try { orca.notify?.("error", `回收站插件加载失败：${e?.message ?? e}`); } catch { /* ignore */ }
  }
}

export function disable() {
  unregisterHeadbarEntry();
  uninstallHook();
  stopCleanupTimer();
  console.log(`${pluginName} unloaded.`);
}
