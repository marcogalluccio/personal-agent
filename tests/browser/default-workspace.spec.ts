import { test, expect } from '@playwright/test';

for (const width of [320, 390])
  test(`ready workspace ${width}px: one tap opens a chat without a repository or tool dialog`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route('**/api/config', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        json: {
          ...(await response.json()),
          quickChat: true,
          defaultRepository: 'example/brain',
          defaultGlobalSkills: true,
        },
      });
    });
    // The UI is tested against a demo backend. Server-side defaults have independent API tests.
    const created: string[] = [];
    await page.route('**/api/conversations', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      expect(body).toEqual({ agent: 'claude' });
      const response = await route.fetch({
        postData: {
          ...body,
          repo: 'example/brain',
          workspaceMode: 'shared',
          tools: { mcp: null, skills: null },
        },
      });
      const chat = await response.json();
      created.push(chat.id);
      await route.fulfill({ response });
    });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Inizia una conversazione' }).click();
      await expect(page.getByRole('dialog', { name: 'Nuova chat' })).toHaveCount(0);
      const composer = page.getByRole('textbox', { name: 'Messaggio', exact: true });
      await expect(composer).toBeVisible();
      expect(created).toHaveLength(1);
      await composer.fill('Riprendi questo handover.');
      await page
        .getByLabel('Seleziona allegati')
        .setInputFiles({
          name: 'handover.md',
          mimeType: 'text/markdown',
          buffer: Buffer.from('# Handover\nRead the current files before continuing.'),
        });
      await page.getByRole('button', { name: 'Invia messaggio', exact: true }).click();
      await expect(page.locator('.message.user')).toContainText('Riprendi questo handover.');
      await expect(page.locator('.file-card').first()).toContainText('handover.md');
      await page.reload();
      await expect(page.locator('.file-card').first()).toContainText('handover.md');
      const ready = await (await request.get(`/api/conversations/${created[0]}`)).json();
      expect(ready.repo).toBe('example/brain');
      expect(ready.tools).toEqual({ mcp: null, skills: null });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByRole('button', { name: 'Nuova chat', exact: true }).last().click();
      await expect.poll(() => created.length).toBe(2);
      await expect(page.getByRole('dialog', { name: 'Nuova chat' })).toHaveCount(0);
      await page.screenshot({
        path: `test-results/default-workspace-${width}.png`,
        fullPage: true,
      });
    } finally {
      for (const id of created) await request.post(`/api/conversations/${id}/delete`, { data: {} });
    }
  });
