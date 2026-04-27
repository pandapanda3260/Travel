import { expect, test } from "@playwright/test";

test.describe("Travel app smoke flows", () => {
  test("health endpoint responds with a healthy payload", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBeTruthy();

    const payload = (await response.json()) as {
      ok?: boolean;
      service?: string;
      checks?: Array<{ name?: string; ok?: boolean }>;
    };

    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("travel-web");
    expect(Array.isArray(payload.checks)).toBe(true);
    expect(payload.checks?.some((item) => item.name === "sqlite" && item.ok)).toBe(true);
  });

  test("login page renders the workbench entry UI", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "登录工作台" })).toBeVisible();
    await expect(page.getByText("Hi Traveler 工作台")).toBeVisible();
  });
});
