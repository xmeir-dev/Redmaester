import { test, expect } from "@playwright/test";

test("home page renders the app shell and nav with no console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });

  await page.goto("/");

  await expect(page.getByRole("link", { name: /redmaester/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Bookmarks" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("the Topics nav tab navigates away from the home page", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("link", { name: "Topics" }).click();

  await expect(page).toHaveURL(/\/topics/);
});
