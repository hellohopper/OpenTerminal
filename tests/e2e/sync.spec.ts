import { test, expect } from "@playwright/test";
import { signIn, blank } from "./helpers";
test("syncs layouts to a second device and prevents stale overwrites", async ({
  page,
  browser,
}) => {
  await signIn(page);
  await blank(page, "Shared research");
  await page.getByRole("button", { name: "DEVICE SYNC", exact: true }).click();
  await page
    .getByRole("button", { name: "Upload this device", exact: true })
    .click();
  await expect(
    page.getByText("Device snapshot uploaded.", { exact: true }),
  ).toBeVisible();
  const second = await browser.newContext();
  try {
    const other = await second.newPage();
    await signIn(other);
    await blank(other, "Other device");
    await other
      .getByRole("button", { name: "DEVICE SYNC", exact: true })
      .click();
    await other
      .getByRole("button", { name: "Upload this device", exact: true })
      .click();
    await expect(other.getByText(/Sync conflict:/)).toBeVisible();
    await other
      .getByLabel("Replace this device with the server snapshot")
      .check();
    await other
      .getByRole("button", { name: "Download to this device", exact: true })
      .click();
    await expect(other.locator("#workspace-select")).toHaveValue(
      await page.locator("#workspace-select").inputValue(),
    );
    await expect(other.locator("#workspace-select option:checked")).toHaveText(
      "Shared research",
    );
    await other
      .getByRole("button", { name: "Upload this device", exact: true })
      .click();
    await expect(
      other.getByText("Device snapshot uploaded.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Upload this device", exact: true })
      .click();
    await expect(page.getByText(/Sync conflict:/)).toBeVisible();
  } finally {
    await second.close();
  }
});
