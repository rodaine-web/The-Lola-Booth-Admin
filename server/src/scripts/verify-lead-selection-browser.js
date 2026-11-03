// Synthetic responses: no live leads are changed.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(10000);
  const leads = [{ id: 'a', first_name: 'Ada', last_name: 'Customer', status: 'NEW' }, { id: 'b', first_name: 'Grace', last_name: 'Customer', status: 'CONTACTED' }];
  const mutations = [];
  let fail = false;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      const endpoint = url.pathname.slice(4);
      if (endpoint === '/auth/me') return route.fulfill({ json: { user: { id: 'owner', name: 'QA Owner', roles: ['OWNER'], permissions: ['*'] } } });
      if (endpoint === '/leads/bulk-action') {
        const body = route.request().postDataJSON(); mutations.push(body);
        if (fail) return route.fulfill({ status: 500, json: { error: { message: 'Action failed. Try again.' } } });
        for (const lead of leads.filter(lead => body.ids.includes(lead.id))) {
          if (body.action === 'delete') lead.deleted = true;
          else lead.archived = body.action === 'archive';
        }
        return route.fulfill({ json: { count: body.ids.length } });
      }
      if (endpoint === '/leads') return route.fulfill({ json: { data: leads.filter(lead => !lead.deleted && Boolean(lead.archived) === (url.searchParams.get('archived') === 'true')) } });
      return route.fulfill({ json: { data: [], unread: 0 } });
    }
    if (url.hostname !== 'admin.test') return route.abort();
    let file = path.join('dist', url.pathname.replace(/^\/customer-documents/, ''));
    try { if (!(await fs.stat(file)).isFile()) file = 'dist/index.html'; } catch { file = 'dist/index.html'; }
    return route.fulfill({ path: file, contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' })[path.extname(file)] });
  });
  const page = await context.newPage();
  await page.goto('https://admin.test/sales/leads');
  const archive = page.getByRole('button', { name: 'Archive selected', exact: true });
  await page.getByLabel('Select Ada Customer').waitFor();
  assert.equal(await archive.isDisabled(), true);
  await page.getByLabel('Select Ada Customer').check();
  assert.equal(new URL(page.url()).pathname, '/sales/leads');
  await archive.click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(mutations.length, 0);
  await archive.click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('1 lead archived.', { exact: true }).waitFor();
  assert.deepEqual(mutations[0], { ids: ['a'], action: 'archive' });
  await page.getByLabel('Lead visibility').selectOption('archived');
  await page.getByLabel('Select displayed records').check();
  await page.getByRole('button', { name: 'Restore selected' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('1 lead restored.', { exact: true }).waitFor();
  await page.getByLabel('Lead visibility').selectOption('active');
  await page.getByRole('button', { name: 'Board view', exact: true }).click();
  await page.getByLabel('Select all visible leads').check();
  await page.getByRole('button', { name: 'Delete selected' }).click();
  fail = true;
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByRole('dialog').getByRole('alert').waitFor();
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  fail = false;
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('2 leads deleted.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Table view', exact: true }).click();
  await page.getByText('No leads found.', { exact: true }).waitFor();
  console.log('PASS: table/kanban selection, cancel, archive, restore, delete, failure/retry, and refresh');
} finally { await browser.close(); }
