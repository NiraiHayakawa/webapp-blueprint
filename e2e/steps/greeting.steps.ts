import { createBdd } from "playwright-bdd";
import { expect } from "@playwright/test";

const { Given: given, Then: then } = createBdd();

given("ビルド済みのトップページを開く", async ({ page }) => {
  await page.goto("/");
});

then("「こんにちは、ゲスト さん」というメッセージが表示される", async ({ page }) => {
  await expect(page.getByText("こんにちは、ゲスト さん")).toBeVisible();
});
