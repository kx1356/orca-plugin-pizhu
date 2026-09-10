// ============================================================
// Orca Tab Bar — 缓存编辑器页签
// 提炼自 orca-neo 主题 v2.0.0 的「缓存编辑器页签」功能
// 点击切换 / 中键关闭 / 拖拽排序 / 拖到面板边缘分栏 / 垂直模式
// ============================================================

let pluginName = "";

/** 面板树节点（叶子面板） */
interface PanelLike {
  id: string;
  view?: string;
  viewArgs?: any;
  children?: PanelLike[];
}

/** 单个缓存页签 */
interface TabEntry {
  key: string;
  view: string;
  viewArgs: any;
  used: number;
  title?: string;
}

/** 固定页签 */
interface PinnedTab {
  view: string;
  viewArgs: any;
  title: string;
  key: string;
}

type DropSide = "left" | "right" | "top" | "bottom" | "center";

// ---- DOM 元素 ----
let tabbarEl: HTMLElement | null = null;        // 页签条容器
let resizeEl: HTMLElement | null = null;        // 垂直模式宽度调节条
let dropHintEl: HTMLElement | null = null;      // 拖拽分栏提示块

// ---- 观察器 ----
let refreshObserver: MutationObserver | null = null;   // 观察 #main 变化触发重绘
let posObserver: MutationObserver | null = null;       // 观察 body class 变化触发定位
let posResizeObserver: ResizeObserver | null = null;   // 观察 #main / #sidebar 尺寸变化
let stateUnsub: (() => void) | null = null;            // 订阅 orca.state（页面切换等）
let settingsUnsub: (() => void) | null = null;         // 订阅插件设置变化

// ---- 运行状态 ----
let renderScheduled = false;
let dragging = false;
let lruCounter = 0;
let lastRenderKey = "";
let dragPayload: { panelId: string; key: string } | null = null; // 拖拽中的 { panelId, key }
let headbarWaiter: MutationObserver | null = null;     // 等待 #headbar 出现的观察器

// 每面板的页签缓存：Map<panelId, TabEntry[]>
const tabCache = new Map<string, TabEntry[]>();

const TABBAR_WIDTH_KEY = "orca-tabbar-width";
const PINNED_KEY = "orca-tabbar-pinned";
const MIN_TABBAR_W = 100;
const MAX_TABBAR_W = 350;
const DEFAULT_TABBAR_W = 150;

// 固定页签（置顶、持久化、不参与 LRU 淘汰）
let pinnedTabs: PinnedTab[] = [];

// ============================================================
// 设置
// ============================================================

function settings() {
  return orca.state.plugins?.[pluginName]?.settings ?? {};
}

function maxTabsPerPanel() {
  const n = Number(settings().maxTabs);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

function isVertical() {
  return document.body.classList.contains("orca-tabbar-vertical");
}

function applyAccentColor() {
  const c = settings().accentColor;
  if (typeof c === "string" && c.trim()) {
    document.body.style.setProperty("--orca-tabbar-accent", c.trim());
  } else {
    document.body.style.removeProperty("--orca-tabbar-accent");
  }
}

function applyVertical() {
  document.body.classList.toggle("orca-tabbar-vertical", settings().verticalTabs === true);
}

function applyAllSettings() {
  applyAccentColor();
  applyVertical();
  scheduleRender();
  updateTabbarPos();
}

// ============================================================
// 工具函数
// ============================================================

// 把面板树拍平成叶子面板列表
function flattenPanels(node: any, out: PanelLike[] = []): PanelLike[] {
  if (!node) return out;
  const list = Array.isArray(node) ? node : [node];
  for (const p of list) {
    if (!p) continue;
    if (p.children && p.children.length) flattenPanels(p.children, out);
    else out.push(p);
  }
  return out;
}

function findPanel(id: string): PanelLike | null {
  const panels: PanelLike[] = [];
  flattenPanels(orca.state?.panels, panels);
  return panels.find(p => p.id === id) ?? null;
}

// view + viewArgs 序列化为缓存 key
function viewKey(view: string, viewArgs: any): string {
  let s = "";
  try {
    const args = viewArgs ?? {};
    s = Object.keys(args).sort().map(k => `${k}=${String(args[k])}`).join("&");
  } catch { /* ignore */ }
  return `${view}|${s}`;
}

// 收集所有面板当前 view 进缓存（LRU 淘汰）
function refreshCache() {
  const panels: PanelLike[] = [];
  flattenPanels(orca.state?.panels, panels);
  const alive = new Set<string>();
  for (const p of panels) if (p.id) alive.add(p.id);
  for (const id of Array.from(tabCache.keys())) if (!alive.has(id)) tabCache.delete(id);

  const max = maxTabsPerPanel();
  for (const p of panels) {
    const id = p.id;
    const view = p.view;
    if (!id || !view || id.startsWith("_")) continue;
    const key = viewKey(view, p.viewArgs);
    let list = tabCache.get(id);
    if (!list) { list = []; tabCache.set(id, list); }
    let entry = list.find((e: TabEntry) => e.key === key);
    if (!entry) { entry = { key, view, viewArgs: { ...(p.viewArgs ?? {}) }, used: 0 }; list.push(entry); }
    entry.used = ++lruCounter;
    // 超出容量时淘汰最久未用且非当前项
    while (list.length > max) {
      let worst = -1;
      let minUsed = Infinity;
      for (let i = 0; i < list.length; i++) {
        if (list[i].key !== key && list[i].used < minUsed) { minUsed = list[i].used; worst = i; }
      }
      if (worst < 0) break;
      list.splice(worst, 1);
    }
  }
}

// ---- 块信息（用于页签标题与图标） ----
function reprOf(block: any): any {
  return block?.properties?.find((p: any) => p.name === "_repr")?.value;
}

function blockOf(id: any): any {
  return id == null ? null : orca.state?.blocks?.[id] ?? null;
}

function formatDate(date: any): string {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat(orca.state?.locale || undefined, { dateStyle: "medium" }).format(d);
  } catch { return ""; }
}

function blockTitle(block: any, depth = 0): string {
  if (!block || depth > 3) return "";
  const repr = reprOf(block);
  if (repr == null) return "";
  if (repr.type === "mirror") return blockTitle(blockOf(repr.mirroredId), depth + 1);
  if (repr.type === "journal") return formatDate(repr.date);
  if (block.aliases?.length) {
    const alias = String(block.aliases[0]);
    return alias.startsWith("/") ? alias.split("/").at(-1) ?? alias : alias;
  }
  if (block.text != null) {
    const text = String(block.text).trim().replace(/(\s*#[^\s#]+)+$/u, "").trim();
    if (text) return text;
  }
  return repr.cap ? String(repr.cap) : `(${repr.type})`;
}

const VIEW_TITLES = {
  journal: "日记",
  search: "搜索",
  tags: "标签",
  graph: "关系图",
  whiteboard: "白板"
};

// 页签标题
function tabTitle(entry: any): string {
  let t = "";
  try {
    if (entry.view === "journal") {
      t = formatDate(entry.viewArgs?.date);
    } else if (entry.view === "block" || entry.view === "bgraph") {
      t = blockTitle(blockOf(entry.viewArgs?.blockId));
      if (t && entry.view === "bgraph") t = `关系图：${t}`;
    }
    if (!t) t = String(entry.viewArgs?.title ?? "");
  } catch { /* ignore */ }
  if (t) { entry.title = t; return t; }
  return entry.title || (VIEW_TITLES as Record<string, string>)[entry.view] || entry.view || "未命名";
}

const TYPE_ICONS = {
  journal: "ti ti-calendar",
  quote: "ti ti-blockquote",
  quote2: "ti ti-blockquote",
  ol: "ti ti-list-numbers",
  ul: "ti ti-list",
  image: "ti ti-photo",
  video: "ti ti-movie",
  audio: "ti ti-volume",
  math: "ti ti-math",
  code: "ti ti-code",
  query: "ti ti-zoom-question",
  query2: "ti ti-zoom-question",
  mermaid: "ti ti-chart-bar",
  table: "ti ti-table",
  table2: "ti ti-table",
  spreadsheet: "ti ti-file-spreadsheet",
  task: "ti ti-checkbox",
  pdf: "ti ti-pdf",
  epub: "ti ti-book",
  whiteboard: "ti ti-chalkboard",
  hr: "ti ti-separator"
};

// 页签图标
function tabIcon(entry: any): string {
  if (entry.view === "journal") return "ti ti-calendar";
  const block = blockOf(entry.viewArgs?.blockId);
  const repr = reprOf(block);
  if (repr == null) return "ti ti-file-text";
  if (repr.type === "heading") {
    const level = Number(repr.level);
    return level >= 1 && level <= 6 ? `ti ti-h-${level}` : "ti ti-heading";
  }
  const icon = (TYPE_ICONS as Record<string, string>)[repr.type];
  if (icon) return icon;
  if (block?.aliases?.length) {
    return block.properties?.find((p: any) => p.name === "_hide")?.value ? "ti ti-file" : "ti ti-hash";
  }
  return "ti ti-cube";
}

// ============================================================
// 切换 / 关闭
// ============================================================

function switchToTab(panelId: string, entry: TabEntry) {
  try {
    orca.nav.goTo(entry.view, entry.viewArgs, panelId);
    orca.nav.switchFocusTo(panelId);
  } catch { /* ignore */ }
}

function closeTab(panelId: string, key: string) {
  const list = tabCache.get(panelId);
  if (!list) return;
  const idx = list.findIndex((e: TabEntry) => e.key === key);
  if (idx < 0) return;
  const panel = findPanel(panelId);
  const isCurrent = panel != null && viewKey(panel.view ?? "", panel.viewArgs) === key;
  if (list.splice(idx, 1), !list.length) {
    try { orca.nav.close(panelId); } catch { /* ignore */ }
    tabCache.delete(panelId);
    scheduleRender();
    return;
  }
  if (isCurrent) {
    const next = list[Math.min(idx, list.length - 1)];
    if (next) switchToTab(panelId, next);
  }
  scheduleRender();
}

// ============================================================
// 拖拽分栏
// ============================================================

function dropHint(): HTMLElement {
  if (!dropHintEl) {
    dropHintEl = document.createElement("div");
    dropHintEl.className = "orca-tab-drophint";
    document.body.appendChild(dropHintEl);
  }
  return dropHintEl;
}

function hideDropHint() {
  dropHintEl?.classList.remove("orca-tab-drophint-on");
}

// 计算落点方向：边缘四分之一判定左右上下，否则中心
function dropSide(rect: DOMRect, x: number, y: number): DropSide {
  const leftRatio = (x - rect.left) / Math.max(1, rect.width);
  const topRatio = (y - rect.top) / Math.max(1, rect.height);
  const sides: [DropSide, number][] = [
    ["left", leftRatio],
    ["right", 1 - leftRatio],
    ["top", topRatio],
    ["bottom", 1 - topRatio]
  ];
  sides.sort((a, b) => a[1] - b[1]);
  return sides[0][1] <= 0.25 ? sides[0][0] : "center";
}

function showDropHint(rect: DOMRect, side: DropSide) {
  const hint = dropHint();
  hint.classList.add("orca-tab-drophint-on");
  let { left, top, width, height } = rect;
  if (side === "left") width = rect.width / 2;
  else if (side === "right") { left = rect.left + rect.width / 2; width = rect.width / 2; }
  else if (side === "top") height = rect.height / 2;
  else if (side === "bottom") { top = rect.top + rect.height / 2; height = rect.height / 2; }
  hint.style.left = `${left}px`;
  hint.style.top = `${top}px`;
  hint.style.width = `${width}px`;
  hint.style.height = `${height}px`;
}

function onDragOver(e: any) {
  if (!dragPayload) return;
  const target = e.target;
  if (tabbarEl && target && tabbarEl.contains(target)) {
    e.preventDefault();
    hideDropHint();
    return;
  }
  const panelEl = target?.closest?.(".orca-panel");
  if (!panelEl) { hideDropHint(); return; }
  e.preventDefault();
  const rect = panelEl.getBoundingClientRect();
  showDropHint(rect, dropSide(rect, e.clientX, e.clientY));
}

function onDrop(e: any) {
  if (!dragPayload) return;
  const payload = dragPayload;
  const target = e.target;
  if (tabbarEl && target && tabbarEl.contains(target)) return;
  const panelEl = target?.closest?.(".orca-panel");
  if (!panelEl) { hideDropHint(); return; }
  e.preventDefault();
  hideDropHint();
  const panelId = panelEl.dataset.panelId;
  if (!panelId) return;
  const entry = tabCache.get(payload.panelId)?.find(t => t.key === payload.key);
  if (!entry) return;
  const rect = panelEl.getBoundingClientRect();
  const side = dropSide(rect, e.clientX, e.clientY);
  try {
    if (side === "center") {
      orca.nav.goTo(entry.view, entry.viewArgs, panelId);
      orca.nav.switchFocusTo(panelId);
    } else {
      const newPanelId = orca.nav.addTo(panelId, side, {
        view: entry.view,
        viewArgs: entry.viewArgs,
        viewState: {}
      });
      if (newPanelId) orca.nav.switchFocusTo(newPanelId);
    }
  } catch { /* ignore */ }
  scheduleRender();
}

// ============================================================
// 固定页签（持久化）
// ============================================================

function loadPinnedTabs(): PinnedTab[] {
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((t: any) => t && t.view).map((t: any) => ({
          view: t.view,
          viewArgs: t.viewArgs ?? {},
          title: t.title ?? "",
          key: viewKey(t.view, t.viewArgs)
        }))
      : [];
  } catch { return []; }
}

function savePinnedTabs() {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify(
      pinnedTabs.map(({ view, viewArgs, title }) => ({ view, viewArgs, title }))
    ));
  } catch { /* ignore */ }
}

function pinTab(entry: TabEntry) {
  if (pinnedTabs.some((t: PinnedTab) => t.key === entry.key)) return;
  pinnedTabs.push({
    view: entry.view,
    viewArgs: { ...(entry.viewArgs ?? {}) },
    title: entry.title ?? tabTitle(entry),
    key: entry.key
  });
  savePinnedTabs();
  scheduleRender();
}

function unpinTab(key: string) {
  const i = pinnedTabs.findIndex((t: PinnedTab) => t.key === key);
  if (i < 0) return;
  pinnedTabs.splice(i, 1);
  savePinnedTabs();
  scheduleRender();
}

// 点击固定页签：优先在活跃面板打开，否则用第一个可用面板
function openPinned(tab: PinnedTab) {
  const panels: PanelLike[] = [];
  flattenPanels(orca.state?.panels, panels);
  const active = orca.state?.activePanel;
  const target = active && panels.some(p => p.id === active)
    ? active
    : (panels.find(p => !p.id.startsWith("_"))?.id ?? undefined);
  try {
    orca.nav.goTo(tab.view, tab.viewArgs, target);
    if (target) orca.nav.switchFocusTo(target);
  } catch { /* ignore */ }
}

// ============================================================
// 渲染
// ============================================================

function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    refreshCache();
    render();
  });
}

function collectTabData(): any[] {
  const panels: PanelLike[] = [];
  flattenPanels(orca.state?.panels, panels);
  const activePanel = orca.state?.activePanel;
  const data: any[] = [];
  for (const p of panels) {
    const id = p.id;
    if (!id || id.startsWith("_")) continue;
    const list = tabCache.get(id);
    if (!list || !list.length) continue;
    data.push({
      panelId: id,
      list,
      currentKey: viewKey(p.view ?? "", p.viewArgs),
      focused: id === activePanel
    });
  }
  return data;
}

function render() {
  if (!tabbarEl || dragging) return;
  const data = collectTabData();
  // 面板缓存中跳过已固定的页签，避免同一页面出现两个页签
  const pinnedKeys = new Set(pinnedTabs.map((t: PinnedTab) => t.key));
  const panels: any[] = [];
  for (const d of data) {
    const list = d.list.filter((e: TabEntry) => !pinnedKeys.has(e.key));
    if (list.length) panels.push({ ...d, list });
  }
  if (!pinnedTabs.length && !panels.length) {
    tabbarEl.innerHTML = "";
    tabbarEl.style.display = "none";
    lastRenderKey = "";
    return;
  }
  // 渲染指纹：内容没变就不重建 DOM
  const key =
    pinnedTabs.map(t => `${t.key}~${t.title}`).join(",") + "||" +
    panels.map(d =>
      `${d.panelId}${d.focused ? "*" : ""}@${d.currentKey}#` +
      d.list.map((e: TabEntry) => `${e.key}~${tabTitle(e)}`).join(",")
    ).join("||");
  if (key === lastRenderKey) return;
  lastRenderKey = key;
  tabbarEl.style.display = "flex";
  tabbarEl.innerHTML = "";
  // 固定页签组置顶，与面板缓存组用分隔线隔开
  for (const t of pinnedTabs) renderPinnedTab(t);
  for (let i = 0; i < panels.length; i++) {
    if (i > 0 || pinnedTabs.length) {
      const sep = document.createElement("div");
      sep.className = "orca-tab-sep";
      tabbarEl.appendChild(sep);
    }
    renderTab(panels[i]);
  }
}

function renderTab(data: any) {
  if (!tabbarEl) return;
  const panelId = data.panelId;
  const currentKey = data.currentKey;
  for (const entry of data.list) {
    const title = tabTitle(entry);
    const tab = document.createElement("div");
    const isCurrent = entry.key === currentKey;
    tab.className = "orca-tab" + (isCurrent ? data.focused ? " orca-tab-active" : " orca-tab-current" : "");
    tab.draggable = true;
    tab.title = title;

    const icon = document.createElement("i");
    icon.className = `orca-tab-icon ${tabIcon(entry)}`;
    tab.appendChild(icon);

    const label = document.createElement("span");
    label.className = "orca-tab-label";
    label.textContent = title;
    tab.appendChild(label);

    const pin = document.createElement("span");
    pin.className = "orca-tab-pin ti ti-pin";
    pin.title = "固定此页签";
    pin.addEventListener("click", e => {
      e.stopPropagation();
      pinTab(entry);
    });
    tab.appendChild(pin);

    const close = document.createElement("span");
    close.className = "orca-tab-close";
    close.textContent = "×";
    close.title = "移出缓存";
    close.addEventListener("click", e => {
      e.stopPropagation();
      closeTab(panelId, entry.key);
    });
    tab.appendChild(close);

    tab.addEventListener("click", () => switchToTab(panelId, entry));
    tab.addEventListener("auxclick", e => {
      if (e.button === 1) { e.preventDefault(); closeTab(panelId, entry.key); }
    });

    // 拖拽
    tab.addEventListener("dragstart", e => {
      const dt = e.dataTransfer;
      if (dt) {
        dragging = true;
        dragPayload = { panelId, key: entry.key };
        dt.effectAllowed = "copyMove";
        try { dt.setData("text/plain", title); } catch { /* ignore */ }
        tab.classList.add("orca-tab-dragging");
      }
    });
    tab.addEventListener("dragend", () => {
      dragging = false;
      dragPayload = null;
      hideDropHint();
      tabbarEl?.querySelectorAll(".orca-tab-insert").forEach(el => el.classList.remove("orca-tab-insert"));
      tab.classList.remove("orca-tab-dragging");
      scheduleRender();
    });
    tab.addEventListener("dragover", e => {
      if (!dragPayload || dragPayload.panelId !== panelId) return;
      e.preventDefault();
      e.stopPropagation();
      tab.classList.add("orca-tab-insert");
    });
    tab.addEventListener("dragleave", () => tab.classList.remove("orca-tab-insert"));
    tab.addEventListener("drop", e => {
      if (!dragPayload || dragPayload.panelId !== panelId) return;
      e.preventDefault();
      e.stopPropagation();
      tab.classList.remove("orca-tab-insert");
      const list = tabCache.get(panelId);
      if (!list) return;
      const payload = dragPayload;
      const from = list.findIndex((r: TabEntry) => r.key === payload.key);
      const to = list.findIndex((r: TabEntry) => r.key === entry.key);
      if (from < 0 || to < 0 || from === to) return;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      dragging = false;
      dragPayload = null;
      scheduleRender();
    });

    tabbarEl.appendChild(tab);
  }
}

// 固定页签渲染：置顶组内，带取消固定按钮，中键也可取消
function renderPinnedTab(tab: PinnedTab) {
  if (!tabbarEl) return;
  const title = tab.title || tab.view || "未命名";
  const activePanel = orca.state?.activePanel;
  const panel = activePanel ? findPanel(activePanel) : null;
  const isActive = panel != null && viewKey(panel.view ?? "", panel.viewArgs) === tab.key;
  const el = document.createElement("div");
  el.className = "orca-tab orca-tab-pinned" + (isActive ? " orca-tab-active" : "");
  el.title = title;

  const icon = document.createElement("i");
  icon.className = `orca-tab-icon ${tabIcon(tab)}`;
  el.appendChild(icon);

  const label = document.createElement("span");
  label.className = "orca-tab-label";
  label.textContent = title;
  el.appendChild(label);

  const pin = document.createElement("span");
  pin.className = "orca-tab-pin ti ti-pin-filled";
  pin.title = "取消固定";
  pin.addEventListener("click", e => {
    e.stopPropagation();
    unpinTab(tab.key);
  });
  el.appendChild(pin);

  el.addEventListener("click", () => openPinned(tab));
  el.addEventListener("auxclick", e => {
    if (e.button === 1) { e.preventDefault(); unpinTab(tab.key); }
  });
  tabbarEl.appendChild(el);
}

// ============================================================
// 页签条定位与宽度
// ============================================================

function updateTabbarPos() {
  if (!tabbarEl) return;
  const main = document.getElementById("main");
  if (!main) return;
  const rect = main.getBoundingClientRect();
  const style = document.body.style;
  const vw = isVertical() ? tabbarEl.getBoundingClientRect().width : 0;
  style.setProperty("--orca-tabbar-left", `${Math.max(0, Math.round(rect.left - vw))}px`);
  style.setProperty("--orca-tabbar-right", `${Math.max(0, Math.round(window.innerWidth - rect.right))}px`);
  style.setProperty("--orca-tabbar-top", `${Math.max(0, Math.round(rect.top))}px`);
  style.setProperty("--orca-tabbar-bottom", `${Math.max(0, Math.round(window.innerHeight - rect.bottom))}px`);
}

function setTabbarWidth(px: number) {
  const w = Math.max(MIN_TABBAR_W, Math.min(MAX_TABBAR_W, Math.round(px)));
  document.body.style.setProperty("--orca-tabbar-w", `${w}px`);
  try { localStorage.setItem(TABBAR_WIDTH_KEY, String(w)); } catch { /* ignore */ }
  updateTabbarPos();
}

function restoreTabbarWidth() {
  try {
    const v = Number(localStorage.getItem(TABBAR_WIDTH_KEY));
    if (v >= MIN_TABBAR_W && v <= MAX_TABBAR_W) {
      document.body.style.setProperty("--orca-tabbar-w", `${v}px`);
    }
  } catch { /* ignore */ }
}

function startResize(e: MouseEvent) {
  if (e.button !== 0 || !tabbarEl) return;
  e.preventDefault();
  const startX = e.clientX;
  const startW = tabbarEl.getBoundingClientRect().width || DEFAULT_TABBAR_W;
  const onMove = (ev: MouseEvent) => setTabbarWidth(startW + ev.clientX - startX);
  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    document.body.style.removeProperty("cursor");
  };
  document.body.style.cursor = "col-resize";
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
}

function resetWidth() {
  setTabbarWidth(DEFAULT_TABBAR_W);
}

// ============================================================
// 启用 / 停用
// ============================================================

function enableTabbar() {
  if (tabbarEl) return;
  const headbar = document.getElementById("headbar");
  if (!headbar) {
    // #headbar 尚未渲染（React 应用初始化中），用观察器等待它出现
    if (!headbarWaiter) {
      headbarWaiter = new MutationObserver(() => {
        if (document.getElementById("headbar")) {
          headbarWaiter?.disconnect();
          headbarWaiter = null;
          enableTabbar();
        }
      });
      headbarWaiter.observe(document.body, { childList: true, subtree: true });
    }
    return;
  }
  if (headbarWaiter) { headbarWaiter.disconnect(); headbarWaiter = null; }

  tabbarEl = document.createElement("div");
  tabbarEl.className = "orca-tabbar";
  headbar.insertAdjacentElement("afterend", tabbarEl);
  restoreTabbarWidth();

  resizeEl = document.createElement("div");
  resizeEl.className = "orca-tabbar-resize";
  resizeEl.addEventListener("mousedown", startResize);
  resizeEl.addEventListener("dblclick", resetWidth);
  tabbarEl.insertAdjacentElement("afterend", resizeEl);

  refreshCache();
  pinnedTabs = loadPinnedTabs();
  render();

  try { stateUnsub = window.Valtio.subscribe(orca.state, scheduleRender); } catch { stateUnsub = null; }

  refreshObserver = new MutationObserver(scheduleRender);
  const main = document.getElementById("main");
  if (main) {
    refreshObserver.observe(main, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "data-panel-id"]
    });
  }

  document.addEventListener("focusin", scheduleRender);
  window.addEventListener("focus", scheduleRender);
  document.addEventListener("dragover", onDragOver, true);
  document.addEventListener("drop", onDrop, true);

  updateTabbarPos();
  posResizeObserver = new ResizeObserver(updateTabbarPos);
  if (main) posResizeObserver.observe(main);
  const sidebar = document.getElementById("sidebar");
  if (sidebar) posResizeObserver.observe(sidebar);
  window.addEventListener("resize", updateTabbarPos);
  document.addEventListener("transitionend", updateTabbarPos);

  posObserver = new MutationObserver(updateTabbarPos);
  posObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });
}

function disableTabbar() {
  headbarWaiter?.disconnect();
  headbarWaiter = null;
  stateUnsub?.();  stateUnsub = null;
  refreshObserver?.disconnect();
  refreshObserver = null;
  posObserver?.disconnect();
  posObserver = null;
  posResizeObserver?.disconnect();
  posResizeObserver = null;
  document.removeEventListener("focusin", scheduleRender);
  window.removeEventListener("focus", scheduleRender);
  document.removeEventListener("dragover", onDragOver, true);
  document.removeEventListener("drop", onDrop, true);
  window.removeEventListener("resize", updateTabbarPos);
  document.removeEventListener("transitionend", updateTabbarPos);
  resizeEl?.removeEventListener("mousedown", startResize);
  resizeEl?.removeEventListener("dblclick", resetWidth);
  resizeEl?.remove();
  resizeEl = null;
  dropHintEl?.remove();
  dropHintEl = null;
  tabbarEl?.remove();
  tabbarEl = null;
  dragging = false;
  dragPayload = null;
  lastRenderKey = "";
  tabCache.clear();
  pinnedTabs = [];
  const style = document.body.style;
  style.removeProperty("--orca-tabbar-left");
  style.removeProperty("--orca-tabbar-right");
  style.removeProperty("--orca-tabbar-top");
  style.removeProperty("--orca-tabbar-bottom");
  style.removeProperty("--orca-tabbar-w");
}

// ============================================================
// 设置 schema 与生命周期
// ============================================================

export async function enable(name: string) {
  pluginName = name;
  try {
    document.body.classList.add("orca-tabbar-on");
    applyAccentColor();
    applyVertical();
    enableTabbar();
    try {
      const pluginState = orca.state.plugins?.[name];
      if (pluginState) settingsUnsub = window.Valtio.subscribe(pluginState, applyAllSettings);
    } catch { settingsUnsub = null; }
    console.log(`${name} loaded.`);
  } catch (e: any) {
    console.error(`[TABBAR] ${name} 加载失败：`, e);
    try { orca.notify?.("error", `页签插件加载失败：${e?.message ?? e}`); } catch { /* ignore */ }
  }
}

export function disable() {
  disableTabbar();
  settingsUnsub?.();
  settingsUnsub = null;
  document.body.classList.remove("orca-tabbar-vertical", "orca-tabbar-on");
  document.body.style.removeProperty("--orca-tabbar-accent");
  console.log(`${pluginName} unloaded.`);
}
