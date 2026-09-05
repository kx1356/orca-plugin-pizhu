// 批注插件样式：Fluent 2 设计语言（波浪线 + 角标 + 批注卡 + 汇总面板）
export const PIZHU_CSS = `
/* ===== Fluent 2 设计令牌 ===== */
:root {
  --pizhu-font: "Segoe UI Variable Text", "Segoe UI Variable", "Segoe UI", var(--orca-fontfamily-ui, system-ui), -apple-system, sans-serif;
  --pizhu-radius-c: 4px;   /* 控件 */
  --pizhu-radius-s: 7px;   /* 表面/列表项 */
  --pizhu-radius-m: 8px;   /* 浮出层 */
  --pizhu-radius-l: 10px;  /* 对话框 */
  --pizhu-accent: var(--orca-color-accent, #0F6CBD);
  --pizhu-text-1: var(--orca-color-text-1, #242424);
  --pizhu-text-2: var(--orca-color-text-2, #616161);
  --pizhu-text-3: var(--orca-color-text-3, #979797);
  --pizhu-bg-1: var(--orca-color-bg-1, #ffffff);
  --pizhu-bg-2: var(--orca-color-bg-2, #fafafa);
  --pizhu-bg-3: var(--orca-color-bg-3, #f0f0f0);
  --pizhu-stroke: var(--orca-color-border, rgba(0, 0, 0, 0.08));
  --pizhu-stroke-strong: var(--orca-color-separator, rgba(0, 0, 0, 0.10));
  --pizhu-danger: #C42B1C;
  --pizhu-shadow-flyout: 0 8px 16px rgba(0, 0, 0, 0.14), 0 0 1px rgba(0, 0, 0, 0.12);
  --pizhu-shadow-dialog: 0 32px 64px rgba(0, 0, 0, 0.24), 0 0 4px rgba(0, 0, 0, 0.20);
  --pizhu-dur: 120ms;
  --pizhu-ease: cubic-bezier(0.33, 0, 0.67, 1);
}
@media (prefers-color-scheme: dark) {
  :root { --pizhu-danger: #F1707B; }
}
@keyframes pizhu-dialog-in {
  from { opacity: 0; transform: scale(1.03); }
  to { opacity: 1; transform: scale(1); }
}

/* ===== 行内批注标记：波浪线 + Fluent 圆形角标 ===== */
.pizhu-ann {
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  text-decoration-thickness: 1.5px;
  cursor: pointer;
  border-radius: var(--pizhu-radius-c);
  transition: background-color var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-ann:hover {
  background-color: rgba(255, 190, 90, 0.22);
}
.pizhu-ann-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.3em;
  height: 1.3em;
  padding: 0 0.3em;
  margin-left: 3px;
  border-radius: 999px;
  background: var(--pizhu-accent);
  color: #fff;
  font-size: 0.62em;
  font-weight: 600;
  line-height: 1;
  transform: translateY(-0.3em);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

/* ===== 悬停预览浮窗：Fluent Flyout + 亚克力 ===== */
.pizhu-preview {
  background: color-mix(in srgb, var(--pizhu-bg-1) 82%, transparent);
  -webkit-backdrop-filter: blur(24px) saturate(125%);
  backdrop-filter: blur(24px) saturate(125%);
  border: 1px solid var(--pizhu-stroke);
  border-radius: var(--pizhu-radius-m);
  box-shadow: var(--pizhu-shadow-flyout);
  padding: 10px 12px;
  max-width: 280px;
  max-height: 220px;
  overflow: auto;
  font-family: var(--pizhu-font);
  font-size: var(--orca-fontsize, 14px);
  line-height: 1.55;
  color: var(--pizhu-text-1);
  pointer-events: auto;
}
.pizhu-preview-note {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ===== 批注卡：Fluent 浮出层 ===== */
.pizhu-card {
  background: color-mix(in srgb, var(--pizhu-bg-1) 90%, transparent);
  -webkit-backdrop-filter: blur(28px) saturate(125%);
  backdrop-filter: blur(28px) saturate(125%);
  border: 1px solid var(--pizhu-stroke);
  border-radius: var(--pizhu-radius-m);
  box-shadow: var(--pizhu-shadow-flyout);
  padding: 14px 16px;
  font-family: var(--pizhu-font);
  font-size: var(--orca-fontsize, 14px);
  width: min(520px, 90vw);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 24px);
  animation: pizhu-dialog-in 140ms var(--pizhu-ease);
}
.pizhu-card-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.pizhu-card-scroll::-webkit-scrollbar { width: 8px; }
.pizhu-card-scroll::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--pizhu-text-1) 15%, transparent);
  border-radius: 4px;
}
.pizhu-card-original {
  font-size: var(--orca-fontsize, 14px);
  color: var(--pizhu-text-2);
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  padding: 6px 10px;
  margin-bottom: 10px;
  background: var(--pizhu-bg-2);
  border-radius: var(--pizhu-radius-s);
  max-height: 72px;
  overflow: auto;
}
.pizhu-card-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--pizhu-stroke-strong);
  border-radius: var(--pizhu-radius-c);
  padding: 6px 10px;
  font-size: var(--orca-fontsize, 14px);
  line-height: 1.5;
  font-family: var(--pizhu-font);
  background: var(--pizhu-bg-1);
  color: var(--pizhu-text-1);
  overflow: hidden;
  resize: none;
  transition: border-color var(--pizhu-dur) var(--pizhu-ease), box-shadow var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-card-input:hover {
  border-color: color-mix(in srgb, var(--pizhu-text-1) 30%, transparent);
}
.pizhu-card-input:focus {
  outline: none;
  border-color: var(--pizhu-accent);
  box-shadow: inset 0 0 0 1px var(--pizhu-accent);
}
.pizhu-card-actions {
  display: flex;
  align-items: center;
  margin-top: 12px;
  gap: 8px;
  flex: none;
}
.pizhu-card-spacer {
  flex: 1;
}
.pizhu-card-btn {
  border: 1px solid var(--pizhu-stroke-strong);
  background: var(--pizhu-bg-1);
  color: var(--pizhu-text-1);
  border-radius: var(--pizhu-radius-c);
  padding: 5px 14px;
  font-size: 13px;
  font-family: var(--pizhu-font);
  font-weight: 400;
  cursor: pointer;
  transition: background-color var(--pizhu-dur) var(--pizhu-ease), border-color var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-card-btn:hover {
  background: color-mix(in srgb, var(--pizhu-text-1) 5%, transparent);
  border-color: color-mix(in srgb, var(--pizhu-text-1) 18%, transparent);
}
.pizhu-card-btn:focus-visible {
  outline: 2px solid var(--pizhu-accent);
  outline-offset: 1px;
}
.pizhu-card-btn-primary {
  background: var(--pizhu-accent);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.pizhu-card-btn-primary:hover {
  background: color-mix(in srgb, var(--pizhu-accent) 88%, #000);
  border-color: transparent;
}
.pizhu-card-btn-danger {
  color: var(--pizhu-danger);
  border-color: color-mix(in srgb, var(--pizhu-danger) 35%, transparent);
}
.pizhu-card-btn-danger:hover {
  background: color-mix(in srgb, var(--pizhu-danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--pizhu-danger) 55%, transparent);
}

/* ===== 顶栏按钮 ===== */
.pizhu-headbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--pizhu-font);
  font-size: 13px;
}

/* ===== 批注输入浮层：Fluent 对话框 ===== */
.pizhu-prompt-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.30);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99990;
}
.pizhu-prompt-card {
  background: var(--pizhu-bg-1);
  border: 1px solid var(--pizhu-stroke);
  border-radius: var(--pizhu-radius-l);
  box-shadow: var(--pizhu-shadow-dialog);
  padding: 20px 24px 24px;
  width: min(440px, 86vw);
  font-family: var(--pizhu-font);
  animation: pizhu-dialog-in 140ms var(--pizhu-ease);
}
.pizhu-prompt-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--pizhu-text-1);
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  margin-bottom: 12px;
  word-break: break-all;
  max-height: 60px;
  overflow: auto;
}
.pizhu-prompt-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--pizhu-stroke-strong);
  border-radius: var(--pizhu-radius-c);
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  font-family: var(--pizhu-font);
  background: var(--pizhu-bg-1);
  color: var(--pizhu-text-1);
  resize: vertical;
  transition: border-color var(--pizhu-dur) var(--pizhu-ease), box-shadow var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-prompt-input:hover {
  border-color: color-mix(in srgb, var(--pizhu-text-1) 30%, transparent);
}
.pizhu-prompt-input:focus {
  outline: none;
  border-color: var(--pizhu-accent);
  box-shadow: inset 0 0 0 1px var(--pizhu-accent);
}
.pizhu-prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.pizhu-prompt-btn {
  border: 1px solid var(--pizhu-stroke-strong);
  background: var(--pizhu-bg-1);
  color: var(--pizhu-text-1);
  border-radius: var(--pizhu-radius-c);
  padding: 6px 16px;
  font-size: 13px;
  font-family: var(--pizhu-font);
  cursor: pointer;
  transition: background-color var(--pizhu-dur) var(--pizhu-ease), border-color var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-prompt-btn:hover {
  background: color-mix(in srgb, var(--pizhu-text-1) 5%, transparent);
  border-color: color-mix(in srgb, var(--pizhu-text-1) 18%, transparent);
}
.pizhu-prompt-btn:focus-visible {
  outline: 2px solid var(--pizhu-accent);
  outline-offset: 1px;
}
.pizhu-prompt-ok {
  background: var(--pizhu-accent);
  border-color: transparent;
  color: #fff;
  font-weight: 600;
}
.pizhu-prompt-ok:hover {
  background: color-mix(in srgb, var(--pizhu-accent) 88%, #000);
  border-color: transparent;
}

/* ===== 批注汇总面板：Fluent 列表 ===== */
.pizhu-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: var(--pizhu-font);
  font-size: 13px;
  background: var(--pizhu-bg-1);
  color: var(--pizhu-text-1);
}
.pizhu-panel-header {
  padding: 14px 16px 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--pizhu-text-1);
  border-bottom: 1px solid var(--pizhu-stroke-strong);
  flex: none;
}
.pizhu-panel-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  margin-left: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pizhu-accent) 14%, transparent);
  color: var(--pizhu-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  vertical-align: middle;
}
.pizhu-panel-empty {
  padding: 32px 16px;
  color: var(--pizhu-text-3);
  text-align: center;
  line-height: 1.8;
}
.pizhu-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  scrollbar-width: thin;
}
.pizhu-panel-list::-webkit-scrollbar { width: 8px; }
.pizhu-panel-list::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--pizhu-text-1) 15%, transparent);
  border-radius: 4px;
}
.pizhu-panel-item {
  padding: 10px 12px;
  border-radius: var(--pizhu-radius-s);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background-color var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-panel-item:hover {
  background: color-mix(in srgb, var(--pizhu-text-1) 4%, transparent);
}
.pizhu-panel-item-top {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.pizhu-panel-item-spacer {
  flex: 1;
}
.pizhu-panel-del {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--pizhu-text-3);
  font-size: 11px;
  line-height: 1;
  padding: 0 3px;
  border-radius: var(--pizhu-radius-c);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--pizhu-dur) var(--pizhu-ease), background-color var(--pizhu-dur) var(--pizhu-ease), color var(--pizhu-dur) var(--pizhu-ease);
}
.pizhu-panel-item:hover .pizhu-panel-del {
  opacity: 1;
}
.pizhu-panel-del:hover {
  color: var(--pizhu-danger);
  background: color-mix(in srgb, var(--pizhu-danger) 8%, transparent);
}
.pizhu-panel-del:focus-visible {
  outline: 2px solid var(--pizhu-accent);
  outline-offset: 1px;
  opacity: 1;
}
.pizhu-panel-ordinal {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pizhu-accent) 14%, transparent);
  color: var(--pizhu-accent);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.pizhu-panel-original {
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  color: var(--pizhu-text-1);
}
.pizhu-panel-note {
  margin-top: 4px;
  color: var(--pizhu-text-1);
  white-space: pre-wrap;
  word-break: break-word;
}
.pizhu-panel-blockref {
  margin-top: 4px;
  font-size: 11px;
  color: var(--pizhu-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`
