import { describe, expect, it } from 'vitest';
import { createTerminalStore } from '../../web/store/terminal';
import { createDisplayStore } from '../../web/store/display';
import { exportWorkspace, importWorkspace } from '../../web/lib/workspaces';
import { readPanelSettings } from '../../web/lib/panel-settings';
import { translate } from '../../web/lib/i18n';
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };

describe('workspace panel settings', () => {
  it('isolates same-type panels, survives workspace switches and reload, and exports with the panel', () => {
    const storage = memory(), terminal = createTerminalStore(storage);
    terminal.getState().createWorkspace('Options settings', 'blank');
    terminal.getState().addWidget('options'); terminal.getState().addWidget('options');
    const id = terminal.getState().widgets[0].id, workspaceId = terminal.getState().activeWorkspaceId;
    terminal.getState().setWidgetSetting(id, 'optionRate', '4.5');
    terminal.getState().setWidgetSetting(id, 'optionView', 'puts');
    terminal.getState().setWidgetSetting(id, 'optionExpiry', { symbol: 'AAPL', date: '2027-01-15' });
    expect(terminal.getState().widgets[1].settings).toBeUndefined();
    const exported = importWorkspace(exportWorkspace(terminal.getState().workspaces.find(w => w.id === workspaceId)!));
    expect(exported.widgets[0].settings).toMatchObject({ optionRate: '4.5', optionView: 'puts' });
    terminal.getState().duplicateWorkspace();
    terminal.getState().setWidgetSetting(id, 'optionRate', '8');
    terminal.getState().switchWorkspace(workspaceId);
    expect(terminal.getState().widgets[0].settings?.optionRate).toBe('4.5');
    const restored = createTerminalStore(storage);
    expect(restored.getState().widgets[0].settings).toEqual(exported.widgets[0].settings);
    restored.getState().removeWidget(id); restored.getState().undoRemoveWidget();
    expect(restored.getState().widgets[0].settings?.optionView).toBe('puts');
  });
  it('ignores unknown, oversized and incompatible imported settings', () => {
    expect(readPanelSettings({ optionGreeks: 'false', optionView: 'wrong', optionRate: '1'.repeat(501), chartIndicators: ['SMA20', 'wrong'], optionColumns: [], newsMode: 'global', unknown: 'ignored' })).toEqual({ newsMode: 'global' });
  });
});
describe('scoped visibility recovery', () => {
  it('restores one workspace or all workspaces without changing sidebar, groups, font or language and supports undo', () => {
    const display = createDisplayStore(memory());
    display.getState().setFontSize(20); display.getState().setLanguage('zh');
    display.getState().setSidebarVisible(false); display.getState().toggleGroup('Research');
    display.getState().setWorkspaceBarVisible(false); display.getState().setSidebarFeaturesVisible(['options'], false);
    display.getState().setPanelsVisible('first', ['panel-a'], false); display.getState().setPanelsVisible('second', ['panel-b'], false);
    display.getState().restorePanelVisibility('first');
    expect(display.getState().hiddenPanels).toEqual({ first: [], second: ['panel-b'] });
    expect(display.getState()).toMatchObject({ sidebarVisible: false, workspaceBarVisible: false, collapsedGroups: ['Research'], fontSize: 20, language: 'zh' });
    display.getState().undoVisibilityRestore();
    expect(display.getState().hiddenPanels).toEqual({ first: ['panel-a'], second: ['panel-b'] });
    display.getState().restorePanelVisibility(); expect(display.getState().hiddenPanels).toEqual({});
    display.getState().undoVisibilityRestore();
    display.getState().restoreSidebarVisibility();
    expect(display.getState()).toMatchObject({ sidebarVisible: true, hiddenSidebarFeatures: [], collapsedGroups: ['Research'], hiddenPanels: { first: ['panel-a'], second: ['panel-b'] } });
    display.getState().undoVisibilityRestore(); expect(display.getState().sidebarVisible).toBe(false);
    display.getState().restorePanelVisibility(); display.getState().setPanelsVisible('third', ['panel-c'], false);
    expect(display.getState().visibilityUndo).toBeNull();
  });
  it('never restores stale undo state after a reload', async () => {
    const storage = memory(), display = createDisplayStore(storage);
    display.getState().setPanelsVisible('first', ['panel-a'], false); display.getState().restorePanelVisibility();
    const restored = createDisplayStore(storage); await restored.persist.rehydrate();
    expect(restored.getState().visibilityUndo).toBeNull();
  });
});
it('translates ledger success, validation errors and comparison errors in Chinese', () => {
  expect(translate('Currency account created.', 'zh')).toBe('币种账户已创建。');
  expect(translate('Currency ledger entry recorded.', 'zh')).toBe('币种账本记录已保存。');
  expect(translate('Invalid mark row', 'zh')).toContain('手动估值格式无效');
  expect(translate('Enter 2–5 distinct, comma-separated symbols.', 'zh')).toContain('请输入 2–5');
});
