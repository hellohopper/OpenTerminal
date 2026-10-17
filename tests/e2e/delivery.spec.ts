import { test, expect } from "@playwright/test";
import { signIn, blank } from "./helpers";
test("creates repeat-volume alerts and saves a due scheduled briefing exactly once", async ({
  page,
}) => {
  await signIn(page);
  await blank(page, "Schedules");
  await page.getByRole("button", { name: "ALERTS", exact: true }).click();
  await page.getByLabel("Alert metric").selectOption("volume");
  await page.getByLabel("Alert threshold").fill("1000");
  await page.getByLabel("Alert repeat seconds").fill("60");
  await page.getByRole("button", { name: "Create alert", exact: true }).click();
  await expect(
    page.getByText("Volume ≥ · repeat 60s", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "SCHEDULES", exact: true }).click();
  await page.getByLabel("Briefing schedule symbols").fill("AAPL");
  await page.getByLabel("Schedule local time").fill("00:00");
  await page.getByLabel("Schedule timezone").fill("UTC");
  await page.getByLabel("Schedule Sun", { exact: true }).check();
  await page.getByLabel("Schedule Sat", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save briefing schedule", exact: true })
    .click();
  await expect(
    page.getByText("Briefing schedule saved.", { exact: true }),
  ).toBeVisible();
  const before = (await (await page.request.get("/api/briefings")).json())
    .entries.length;
  const first = await (
    await page.request.post("/api/delivery/check", { headers:{origin:"http://127.0.0.1:3100"}, data: {} })
  ).json();
  expect(first.generated).toBe(1);
  const second = await (
    await page.request.post("/api/delivery/check", { headers:{origin:"http://127.0.0.1:3100"}, data: {} })
  ).json();
  expect(second.generated).toBe(0);
  expect(
    (await (await page.request.get("/api/briefings")).json()).entries.length,
  ).toBe(before + 1);
  await page
    .getByRole("button", { name: "Pause schedule", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume schedule", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Delete schedule", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume schedule", exact: true }),
  ).toHaveCount(0);
});
