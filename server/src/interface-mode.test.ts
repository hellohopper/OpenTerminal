import { it, expect } from "vitest";
import { createInterfaceStore } from "../../web/store/interface";
import { createTerminalStore } from "../../web/store/terminal";
import { exportWorkspace, importWorkspace } from "../../web/lib/workspaces";
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
it("remembers the interface and simple page independently of desktop layouts", () => {
  const storage = memory(), ui = createInterfaceStore(storage);
  ui.getState().setMode("simple"); ui.getState().setPage("holdings");
  expect(createInterfaceStore(storage).getState()).toMatchObject({ mode: "simple", page: "holdings" });
  const terminal = createTerminalStore(memory()), before = terminal.getState().layout;
  terminal.getState().setSimpleCards(["watchlist", "alerts"]);
  expect(importWorkspace(exportWorkspace(terminal.getState().workspaces[0])).simpleCards).toEqual(["watchlist", "alerts"]);
  expect(terminal.getState().layout).toEqual(before);
  const first = terminal.getState().activeWorkspaceId;
  terminal.getState().createWorkspace("Other");
  expect(terminal.getState().simpleCards).toBeUndefined();
  terminal.getState().switchWorkspace(first);
  expect(terminal.getState().simpleCards).toEqual(["watchlist", "alerts"]);
});
it("remembers a different portfolio per workspace and validates restored account IDs",()=>{
 const storage=memory(),ui=createInterfaceStore(storage);ui.getState().setAccount("one",4);ui.getState().setAccount("two",9);
 expect(createInterfaceStore(storage).getState().accounts).toEqual({one:4,two:9});
 storage.setItem("openterminal-interface",JSON.stringify({state:{accounts:{one:-1,two:"oops",three:3}},version:0}));
 expect(createInterfaceStore(storage).getState().accounts).toEqual({three:3});
});
