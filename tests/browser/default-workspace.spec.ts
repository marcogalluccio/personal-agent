import { test, expect } from '@playwright/test';

for (const width of [320, 390])
  test(`ready workspace ${width}px: agent choice persists without changing existing chats`, async ({
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
    const chats: { id: string; agent: string }[] = [];
    await page.route('**/api/conversations', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON();
      expect(Object.keys(body)).toEqual(['agent']);
      const response = await route.fetch({
        postData: {
          ...body,
          repo: 'example/brain',
          workspaceMode: 'shared',
          tools: { mcp: null, skills: null },
        },
      });
      chats.push(await response.json());
      await route.fulfill({ response });
    });
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Apri menu', exact: true }).click();
      const group = page.getByRole('group', { name: 'Agente per le nuove chat' });
      await group.waitFor();
      await expect(
        group.getByRole('button', { name: 'Nuove chat con Claude Code' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await group.getByRole('button', { name: 'Nuove chat con Codex' }).click();
      await expect(group.getByRole('button', { name: 'Nuove chat con Codex' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      for (const button of await group.getByRole('button').all())
        expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `test-results/agent-choice-${width}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.locator('.new-chat').click();
      await expect.poll(() => chats.length).toBe(1);
      expect(chats[0].agent).toBe('codex');
      await expect(page.getByRole('textbox', { name: 'Messaggio', exact: true })).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Nuova chat', exact: true })).toHaveCount(0);
      await page.reload();
      await page.getByRole('button', { name: 'Apri menu', exact: true }).click();
      await expect(group.getByRole('button', { name: 'Nuove chat con Codex' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'Chiudi menu', exact: true }).click();
      await page.getByRole('button', { name: 'Nuova chat', exact: true }).last().click();
      await expect.poll(() => chats.length).toBe(2);
      expect(chats[1].agent).toBe('codex');
      await page.getByRole('button', { name: 'Apri menu', exact: true }).click();
      await group.getByRole('button', { name: 'Nuove chat con Claude Code' }).click();
      expect((await (await request.get(`/api/conversations/${chats[1].id}`)).json()).agent).toBe(
        'codex',
      );
      await page.locator('.new-chat').click();
      await expect.poll(() => chats.length).toBe(3);
      expect(chats[2].agent).toBe('claude');
      const detail = await (await request.get(`/api/conversations/${chats[2].id}`)).json();
      expect(detail.repo).toBe('example/brain');
      expect(detail.workspace_mode).toBe('shared');
      expect(detail.tools).toEqual({ mcp: null, skills: null });
    } finally {
      for (const chat of chats)
        await request.post(`/api/conversations/${chat.id}/delete`, { data: {} });
    }
  });

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
      await page.getByLabel('Seleziona allegati').setInputFiles({
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
