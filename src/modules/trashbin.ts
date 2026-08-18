// ============================================================
// @ts-nocheck
// Orca Trash Bin — 回收站
// 提炼自 orca-neo 主题 v2.0.0
// 拦截删除操作，自动保存页面快照，可随时恢复或彻底删除
// ============================================================

let pluginName = "";

// ---- 后端 hook ----
let originalBackend = null;   // 被 hook 前的原始 invokeBackend
let cleanupTimer = null;      // 过期清理定时器

// ---- React 全局 ----
let React = null;
let ReactDOM = null;

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

function backend() {
  return originalBackend || orca.invokeBackend.bind(orca);
}

// 拦截 invokeBackend 的 delete-blocks：删除前先把顶层块快照进回收站
function installHook() {
  if (originalBackend) return;
  originalBackend = orca.invokeBackend.bind(orca);
  orca.invokeBackend = async (name, ...args) => {
    if (name !== "delete-blocks") return originalBackend(name, ...args);
    try {
      return await interceptDelete(args);
    } catch (e) {
      console.error("[TRASH] 拦截异常，已取消删除以保数据：", e);
      try {
        orca.notify?.("error", `回收站：删除已被拦截（${e?.message ?? e}），页面未删除以保数据。可重试或检查存储。`, { title: "回收站" });
      } catch { /* ignore */ }
      return [];
    }
  };
}

function uninstallHook() {
  if (originalBackend) {
    orca.invokeBackend = originalBackend;
    originalBackend = null;
  }
}

async function interceptDelete(args) {
  const b = backend();
  if (!trashEnabled()) return b("delete-blocks", ...args);
  const ids = Array.isArray(args[0]) ? args[0] : [];
  const repo = orca.state.repo;
  for (const id of ids) {
    let block = null;
    try { block = await b("get-block", id); } catch { block = null; }
    // 只快照顶层块（无父块 = 页面）
    if (block && (block.parent == null || block.parent === undefined || block.parent === "")) {
      await snapshotPage(b, repo, id, block);
    }
  }
  return b("delete-blocks", ...args);
}

// ============================================================
// 快照与索引
// ============================================================

// 递归快照块树
async function snapshotTree(b, blockId, seen = new Set(), depth = 0) {
  if (seen.has(blockId) || depth > 500) return null;
  seen.add(blockId);
  let block = null;
  try { block = await b("get-block", blockId); } catch { block = null; }
  if (!block) return null;
  const kids = [];
  for (const childId of Array.isArray(block.children) ? block.children : []) {
    if (typeof childId === "number") {
      const kid = await snapshotTree(b, childId, seen, depth + 1);
      if (kid) kids.push(kid);
    }
  }
  return {
    id: block.id,
    text: typeof block.text === "string" ? block.text : "",
    aliases: Array.isArray(block.aliases) ? block.aliases : [],
    properties: Array.isArray(block.properties) ? block.properties : [],
    kids
  };
}

async function snapshotPage(b, repo, pageId, block) {
  const tree = (await snapshotTree(b, pageId)) ?? block;
  const record = {
    pageId,
    deletedAt: Date.now(),
    originalParent: block?.parent ?? null,
    originalLeft: block?.left ?? null,
    tree
  };
  const file = `trash/${repo}/${pageId}.json`;
  await b("set-plugin-file", pluginName, file, JSON.stringify(record));
  const list = await readIndex(b, repo);
  const entry = {
    pageId,
    fileName: file,
    deletedAt: record.deletedAt,
    originalParent: record.originalParent,
    originalLeft: record.originalLeft,
    title: titleOf(tree)
  };
  await writeIndex(b, repo, [...list.filter(e => e.pageId !== pageId), entry]);
  try {
    orca.notify?.("success", `已移入回收站：${entry.title}`, { title: "回收站" });
  } catch { /* ignore */ }
}

function indexKey(repo) {
  return `trash-index:${repo}`;
}

async function readIndex(b, repo) {
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

async function writeIndex(b, repo, list) {
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
  return list.map(e => ({
    ...e,
    remainingMs: Math.max(0, e.deletedAt + ttl - now)
  }));
}

async function trashCount() {
  return trashList().then(l => l.length).catch(() => 0);
}

// 恢复：读快照 → 递归重建块 → 删除快照文件 → 更新索引
async function restorePage(pageId) {
  const b = backend();
  const repo = orca.state.repo;
  const file = `trash/${repo}/${pageId}.json`;
  const raw = await b("get-plugin-file", pluginName, file);
  const record = JSON.parse(raw);
  await rebuildTree(b, record.tree, record.originalParent ?? null, record.originalLeft ?? null);
  try { await b("remove-plugin-file", pluginName, file); } catch { /* ignore */ }
  const list = await readIndex(b, repo);
  await writeIndex(b, repo, list.filter(e => e.pageId !== pageId));
  try {
    orca.notify?.("success", `已恢复：${record?.tree ? titleOf(record.tree) : pageId}`, { title: "回收站" });
  } catch { /* ignore */ }
}

// 递归重建块树，返回创建出的块 id
async function rebuildTree(b, node, parentId, leftId) {
  if (node == null) return null;
  const { repr, content } = splitRepr(node);
  const text = typeof node?.text === "string" ? node.text : "";
  let createdId;
  try {
    createdId = await b("create-block", parentId, leftId, null, null, repr, content, text);
  } catch (e) {
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
      catch (t) { console.warn("[TRASH] 恢复页面别名失败：", t); }
    }
  }
  let prev = null;
  for (const kid of node.kids ?? []) {
    const kidId = await rebuildTree(b, kid, id, prev);
    if (kidId != null) prev = kidId;
  }
  return id;
}

function extractId(result) {
  if (result == null) return null;
  if (Array.isArray(result)) {
    const first = result[0];
    return first && typeof first === "object" ? first.id ?? first : first;
  }
  return typeof result === "object" ? result.id ?? result : result;
}

// 从快照节点拆出 repr 与富文本内容
function splitRepr(node) {
  const reprProp = Array.isArray(node?.properties)
    ? node.properties.find(p => p && p.name === "_repr")
    : null;
  const repr = reprProp && reprProp.value ? reprProp.value : { type: "text" };
  const text = (typeof node?.text === "string" ? node.text : "").replace(/\n+$/, "");
  return { repr, content: text ? [{ t: "t", v: text }] : [] };
}

// 彻底删除单个
async function purgePage(pageId) {
  const b = backend();
  const repo = orca.state.repo;
  const file = `trash/${repo}/${pageId}.json`;
  try { await b("remove-plugin-file", pluginName, file); } catch { /* ignore */ }
  const list = await readIndex(b, repo);
  await writeIndex(b, repo, list.filter(e => e.pageId !== pageId));
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
  const keep = [];
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

function titleOf(node) {
  if (!node) return "(无标题)";
  const t = firstText(node);
  return t ? t.slice(0, 80) : "(无标题)";
}

function firstText(node) {
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

function formatTime(ts) {
  try {
    const d = new Date(ts);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ""; }
}

function remainingText(ms) {
  const days = ms / 864e5;
  return days <= 0 ? "今天过期" : days < 1 ? "剩不到 1 天" : `剩 ${Math.ceil(days)} 天`;
}

function TrashDialog({ onClose }) {
  const [items, setItems] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const refresh = React.useCallback(() => {
    trashList().then(setItems).catch(() => setItems([]));
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);
  React.useEffect(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function restore(id) {
    setBusy(true);
    try { await restorePage(id); refresh(); }
    catch (e) { orca.notify?.("error", `恢复失败：${e?.message ?? e}`, { title: "回收站" }); }
    finally { setBusy(false); }
  }
  async function purge(id) {
    setBusy(true);
    try { await purgePage(id); refresh(); }
    catch (e) { orca.notify?.("error", `删除失败：${e?.message ?? e}`, { title: "回收站" }); }
    finally { setBusy(false); }
  }
  async function purgeAllItems() {
    if (items.length !== 0 && window.confirm(`确定清空回收站？共 ${items.length} 项将被永久删除，不可恢复。`)) {
      setBusy(true);
      try { await purgeAll(); refresh(); }
      catch (e) { orca.notify?.("error", `清空失败：${e?.message ?? e}`, { title: "回收站" }); }
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
    React.createElement("div", { className: "orca-trash-pop", onMouseDown: e => e.stopPropagation() },
      React.createElement("div", { className: "orca-trash-head" },
        React.createElement("span", null, "回收站"),
        React.createElement("div", { className: "orca-trash-head-tools" },
          React.createElement("button", {
            className: "orca-trash-sort",
            title: "切换排序方式",
            onClick: () => setSort(s => s === "deletedDesc" ? "remainingAsc" : "deletedDesc")
          }, sort === "deletedDesc" ? "删除时间倒序 ↓" : "剩余时长 ↑"),
          React.createElement("span", { className: "orca-trash-close", onClick: onClose }, "✕")
        )
      ),
      React.createElement("div", { className: "orca-trash-body" },
        sorted.length === 0 && React.createElement("div", { className: "orca-trash-empty" }, "回收站为空"),
        sorted.map(item =>
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
  let root = null;
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
  } catch (e) {
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

export async function enable(name) {
  pluginName = name;
  try {
    installHook();
    startCleanupTimer();
    await purgeExpired().catch(() => { /* ignore */ });
    registerHeadbarEntry();
    console.log(`${name} loaded.`);
  } catch (e) {
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
