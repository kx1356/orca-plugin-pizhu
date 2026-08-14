// 批注插件样式：波浪线 + 角标 + 批注卡 + 汇总面板
export const PIZHU_CSS = `
/* ===== 行内批注标记：波浪线 + 角标 ===== */
.pizhu-ann {
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  text-decoration-thickness: 1.5px;
  cursor: pointer;
  border-radius: 3px;
  transition: background-color 0.15s ease;
}
.pizhu-ann:hover {
  background-color: rgba(255, 190, 90, 0.22);
}
.pizhu-ann-badge {
  display: inline-block;
  font-size: 0.62em;
  line-height: 1;
  color: var(--orca-color-text-2, #8a8f98);
  background: transparent;
  margin-left: 1px;
  transform: translateY(-0.2em);
  font-weight: 600;
  user-select: none;
}
.pizhu-ann:hover .pizhu-ann-badge {
  color: var(--orca-color-text-1, #555);
}

/* ===== 悬停预览浮窗 ===== */
.pizhu-preview {
  background: var(--orca-color-bg-1, #fff);
  border: 1px solid var(--orca-color-border, rgba(0,0,0,0.12));
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  padding: 8px 10px;
  max-width: 280px;
  max-height: 140px;
  overflow: auto;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--orca-color-text-1, #333);
  pointer-events: auto;
}
.pizhu-preview-note {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ===== 批注卡 ===== */
.pizhu-card {
  background: var(--orca-color-bg-1, #fff);
  border: 1px solid var(--orca-color-border, rgba(0,0,0,0.12));
  border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.14);
  padding: 12px 14px;
  font-size: 13px;
}
.pizhu-card-original {
  font-size: 12px;
  color: var(--orca-color-text-2, #777);
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  padding: 4px 6px;
  margin-bottom: 8px;
  background: var(--orca-color-bg-2, #fafafa);
  border-radius: 6px;
  max-height: 72px;
  overflow: auto;
}
.pizhu-card-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--orca-color-border, rgba(0,0,0,0.15));
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  line-height: 1.5;
  background: var(--orca-color-bg-1, #fff);
  color: var(--orca-color-text-1, #333);
  resize: vertical;
  font-family: inherit;
}
.pizhu-card-input:focus {
  outline: none;
  border-color: var(--orca-color-accent, #4a9eff);
}
.pizhu-card-actions {
  display: flex;
  align-items: center;
  margin-top: 10px;
  gap: 6px;
}
.pizhu-card-spacer {
  flex: 1;
}
.pizhu-card-btn {
  border: 1px solid var(--orca-color-border, rgba(0,0,0,0.15));
  background: var(--orca-color-bg-1, #fff);
  color: var(--orca-color-text-1, #333);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.pizhu-card-btn:hover {
  background: var(--orca-color-bg-2, #f5f5f5);
}
.pizhu-card-btn-primary {
  background: var(--orca-color-accent, #4a9eff);
  border-color: transparent;
  color: #fff;
}
.pizhu-card-btn-primary:hover {
  opacity: 0.9;
}
.pizhu-card-btn-danger {
  color: #e05555;
  border-color: rgba(224, 85, 85, 0.35);
}

/* ===== 顶栏按钮 ===== */
.pizhu-headbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

/* ===== 批注输入浮层 ===== */
.pizhu-prompt-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99990;
}
.pizhu-prompt-card {
  background: var(--orca-color-bg-1, #fff);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
  padding: 16px;
  width: min(420px, 86vw);
}
.pizhu-prompt-label {
  font-size: 13px;
  color: var(--orca-color-text-1, #333);
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  margin-bottom: 10px;
  word-break: break-all;
  max-height: 60px;
  overflow: auto;
}
.pizhu-prompt-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--orca-color-border, rgba(0,0,0,0.15));
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.5;
  background: var(--orca-color-bg-1, #fff);
  color: var(--orca-color-text-1, #333);
  resize: vertical;
  font-family: inherit;
}
.pizhu-prompt-input:focus {
  outline: none;
  border-color: var(--orca-color-accent, #4a9eff);
}
.pizhu-prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
.pizhu-prompt-btn {
  border: 1px solid var(--orca-color-border, rgba(0,0,0,0.15));
  background: var(--orca-color-bg-1, #fff);
  color: var(--orca-color-text-1, #333);
  border-radius: 6px;
  padding: 5px 16px;
  font-size: 13px;
  cursor: pointer;
}
.pizhu-prompt-btn:hover {
  background: var(--orca-color-bg-2, #f5f5f5);
}
.pizhu-prompt-ok {
  background: var(--orca-color-accent, #4a9eff);
  border-color: transparent;
  color: #fff;
}
.pizhu-prompt-ok:hover {
  opacity: 0.9;
}
.pizhu-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-size: 13px;
}
.pizhu-panel-header {
  padding: 10px 14px;
  font-weight: 600;
  color: var(--orca-color-text-1, #333);
  border-bottom: 1px solid var(--orca-color-border, rgba(0,0,0,0.08));
  flex: none;
}
.pizhu-panel-count {
  margin-left: 6px;
  font-size: 12px;
  color: var(--orca-color-text-2, #888);
  font-weight: 400;
}
.pizhu-panel-empty {
  padding: 24px 16px;
  color: var(--orca-color-text-3, #aaa);
  text-align: center;
  line-height: 1.8;
}
.pizhu-panel-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
}
.pizhu-panel-item {
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 2px;
}
.pizhu-panel-item:hover {
  background: var(--orca-color-bg-2, #f5f5f5);
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
  border: none;
  background: transparent;
  color: var(--orca-color-text-3, #bbb);
  font-size: 11px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.12s ease, color 0.12s ease;
}
.pizhu-panel-item:hover .pizhu-panel-del {
  opacity: 1;
}
.pizhu-panel-del:hover {
  color: #e05555;
  background: rgba(224, 85, 85, 0.1);
}
.pizhu-panel-ordinal {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: #d08a2c;
  min-width: 18px;
  text-align: center;
  background: rgba(255, 170, 60, 0.15);
  border-radius: 9px;
  padding: 1px 4px;
}
.pizhu-panel-original {
  text-decoration: underline wavy;
  text-decoration-color: rgba(255, 170, 60, 0.85);
  text-underline-offset: 3px;
  color: var(--orca-color-text-1, #333);
}
.pizhu-panel-note {
  margin-top: 4px;
  color: var(--orca-color-text-1, #333);
  white-space: pre-wrap;
  word-break: break-word;
}
.pizhu-panel-blockref {
  margin-top: 4px;
  font-size: 11px;
  color: var(--orca-color-text-3, #999);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`
