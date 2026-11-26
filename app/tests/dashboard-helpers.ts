import { expect, type Page } from "@playwright/test";

/** Secondary navigation moves into the native dialog on compact viewports. */
export async function openDashboardPanel(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "Game menu", exact: false }).click();
  await button.click();
}
export async function expectDashboardFocus(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await expect(
    (await button.isVisible())
      ? button
      : page.getByRole("button", { name: "Game menu", exact: false }),
  ).toBeFocused();
}
