import { test, expect } from "@playwright/test";
import { signIn, blank } from "./helpers";
test("models signed strategy Greeks, updates scenarios and saves assumptions", async ({
  page,
}) => {
  await signIn(page);
  await blank(page, "Risk");
  await page.getByRole("button", { name: "STRATEGY", exact: true }).click();
  await page.getByRole("button", { name: "Add leg", exact: true }).click();
  await page.getByLabel("Leg 1 strike").fill("100");
  await page.getByLabel("Leg 1 premium").fill("5");
  await page.getByLabel("Risk spot", { exact: true }).fill("100");
  await page
    .getByLabel("Risk expiration", { exact: true })
    .fill(new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10));
  await expect(page.getByTestId("risk-delta")).toHaveText(/\d/);
  const long = Number(
    (await page.getByTestId("risk-delta").innerText()).replaceAll(",", ""),
  );
  expect(long).toBeGreaterThan(0);
  await page.getByLabel("Leg 1 side").selectOption("SELL");
  expect(
    Number(
      (await page.getByTestId("risk-delta").innerText()).replaceAll(",", ""),
    ),
  ).toBeLessThan(0);
  const before = await page.getByTestId("risk-scenarios").innerText();
  await page.getByLabel("Risk days forward").fill("60");
  await expect(page.getByTestId("risk-scenarios")).not.toHaveText(before);
  await page
    .getByRole("button", { name: "Save risk scenario to journal", exact: true })
    .click();
  await expect(
    page.getByText("Risk scenario saved to journal.", { exact: true }),
  ).toBeVisible();
});
