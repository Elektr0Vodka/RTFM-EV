import { test, expect, nudgeEchoBot } from '../helpers/meshTrafficTest';

test.describe('Packet Feed page', () => {
  test('packet feed page loads and shows header', async ({ page }) => {
    await page.goto('/#raw');

    await expect(page.getByText('Raw Packet Feed')).toBeVisible({ timeout: 10_000 });
  });

  test('a packet appears in the raw packet feed', { tag: '@mesh-traffic' }, async ({ page }) => {
    // This test waits for real RF traffic - needs 180s timeout
    test.setTimeout(180_000);

    // Nudge echo bot on #flightless - may generate a packet quickly
    await nudgeEchoBot();

    await page.goto('/#raw');
    await expect(page.getByText('Raw Packet Feed')).toBeVisible({ timeout: 10_000 });

    // Wait for any route-type badge to appear, confirming a packet rendered
    const routeBadge = page.locator(
      '[title="Flood"], [title="Direct"], [title="Transport Flood"], [title="Transport Direct"]'
    );
    await expect(routeBadge.first()).toBeVisible({ timeout: 170_000 });
  });
});
