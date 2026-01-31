import { expect, test } from "@playwright/test";

test("enter + exit position hits Hyperliquid mock trading and shows proof links", async ({
  page,
  request,
}) => {
  const symbol = `TST${Date.now().toString().slice(-6)}`;

  // Create a local custodial wallet.
  const wRes = await request.post("/api/wallets", {
    data: {},
  });
  expect(wRes.ok()).toBeTruthy();
  const wJson = (await wRes.json()) as {
    wallet: { address: string };
  };
  const addr = wJson.wallet.address;

  // Enter a position (mock trading mode will fill instantly).
  const enterRes = await request.post("/api/positions", {
    data: { symbol, side: "long", notional: 100, wallet: addr },
  });
  expect(enterRes.ok()).toBeTruthy();
  const enterJson = (await enterRes.json()) as {
    position: { id: number };
    trade: { proof: { hypurrscanAddressUrl: string; dexlyAddressUrl: string } };
  };
  expect(enterJson.trade.proof.hypurrscanAddressUrl).toContain(addr.toLowerCase());

  await page.goto("/");

  // Open positions table should include BTC and a proof link.
  const row = page.locator("tr", { hasText: symbol }).first();
  await expect(row).toBeVisible();
  // Proof is surfaced as a global account link now (not per-position).
  await expect(page.getByRole("link", { name: "Hypurrscan" }).first()).toBeVisible();

  // Exit the position and confirm it disappears.
  await row.getByRole("button", { name: "Exit" }).click();
  // Exit uses the API and should surface proof links after a successful close.
  const proofCard = page.getByText("Latest trade proof:").locator("..");
  await expect(proofCard).toBeVisible();
  await expect(proofCard.getByRole("link", { name: "Hypurrscan" })).toHaveAttribute(
    "href",
    /hypurrscan\.io\/address\//,
  );
  await expect(proofCard.getByRole("link", { name: "Dexly" })).toHaveAttribute(
    "href",
    /dexly\.trade\/explorer/,
  );
  await expect(page.locator("tr", { hasText: symbol })).toHaveCount(0);
});
