import { test, expect } from "@playwright/test";
import { signIn, blank } from "./helpers";
test("shows holdings earnings and macro context and exports a reminder calendar", async ({
  page,
}) => {
  await signIn(page);
  const headers = { origin: "http://127.0.0.1:3100" };
  const created = await page.request.post("/api/portfolios", {
    headers,
    data: { name: "Event fixture" },
  });
  const { id } = await created.json();
  expect(created.status()).toBe(201);
  expect(
    (
      await page.request.post(`/api/portfolios/${id}/transactions`, {
        headers,
        data: {
          symbol: "AAPL",
          side: "BUY",
          quantity: 3,
          price: 100,
          executed_at: "2026-01-01T00:00:00Z",
        },
      })
    ).status(),
  ).toBe(201);
  await blank(page, "Events");
  await page
    .getByRole("button", { name: "HOLDING EVENTS", exact: true })
    .click();
  await page.getByLabel("Event portfolio").selectOption(String(id));
  await page.getByLabel("Include workspace watchlist").uncheck();
  await expect(page.getByText("AAPL earnings", { exact: true })).toBeVisible();
  await expect(
    page
      .getByText("AAPL: 3.0000 shares · 330.00 USD · 100.00%", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByText("USD · Fixture CPI", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Event type").selectOption("earnings");
  await expect(
    page.getByText("USD · Fixture CPI", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Include a 24-hour calendar reminder").check();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export visible events", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("holding-events.ics");
  await expect(page.getByText(/Calendar downloaded/)).toBeVisible();
});
