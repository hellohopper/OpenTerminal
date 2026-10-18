import { test, expect, type Page } from "@playwright/test";
import { signIn, blank } from "./helpers";
async function confirmPreview(page: Page, direction: string) {
  await page.getByLabel("I reviewed these changes").check();
  await page.getByRole("button", { name: `Confirm ${direction}`, exact: true }).click();
}
test("previews two-device sync, catches concurrent writes, restores history and selectively downloads", async ({ page, browser }) => {
  await signIn(page); await blank(page, "Shared research");
  await page.getByRole("button", { name: "DEVICE SYNC", exact: true }).click();
  await page.getByRole("button", { name: "Upload this device", exact: true }).click();
  await expect(page.getByRole("region", { name: "Sync change preview" })).toContainText("Shared research");
  await expect(page.getByRole("button", { name: "Confirm upload", exact: true })).toBeDisabled();
  await confirmPreview(page, "upload");
  await expect(page.getByText("Device snapshot uploaded.", { exact: true })).toBeVisible();
  const original = await (await page.request.get("/api/sync")).json();
  const second = await browser.newContext();
  try {
    const other = await second.newPage(); await signIn(other); await blank(other, "Other device");
    await other.getByRole("button", { name: "DEVICE SYNC", exact: true }).click();
    await other.getByRole("button", { name: "Download to this device", exact: true }).click();
    await expect(other.getByRole("region", { name: "Sync change preview" })).toContainText("Removed");
    await confirmPreview(other, "download");
    await expect(other.locator("#workspace-select option:checked")).toHaveText("Shared research");
    // Both devices review the same revision; only the first confirmation succeeds.
    await page.getByRole("button", { name: "Upload this device", exact: true }).click();
    await other.getByRole("button", { name: "Upload this device", exact: true }).click();
    await confirmPreview(other, "upload"); await expect(other.getByText("Device snapshot uploaded.", { exact: true })).toBeVisible();
    await confirmPreview(page, "upload"); await expect(page.getByText(/Sync conflict:/)).toBeVisible();
    // Selective download keeps the local-only workspace and its active selection.
    await blank(page, "Keep local"); await page.getByRole("button", { name: "DEVICE SYNC", exact: true }).click();
    await page.getByLabel("Sync scope").selectOption("selected");
    await page.getByRole("checkbox", { name: /Shared research/ }).check();
    await page.getByRole("button", { name: "Download to this device", exact: true }).click();
    await expect(page.getByRole("region", { name: "Sync change preview" })).toContainText("Keep local");
    await expect(page.getByRole("region", { name: "Sync change preview" })).not.toContainText("Removed");
    await confirmPreview(page, "download");
    await expect(page.locator("#workspace-select option:checked")).toHaveText("Keep local");
    await page.getByText("Server version history", { exact: true }).click();
    await page.getByLabel("Saved sync version").selectOption(original.version);
    await page.getByRole("button", { name: "Preview server restore", exact: true }).click();
    await confirmPreview(page, "server restore");
    await expect(page.getByText(/Server version restored\./)).toBeVisible();
    const restored = await (await page.request.get("/api/sync")).json();
    expect(restored.version).not.toBe(original.version);
    expect(restored.payload).toEqual(original.payload);
  } finally { await second.close(); }
});
