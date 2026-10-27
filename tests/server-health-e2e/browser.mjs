import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const origin = 'https://pulsy-e2e';
const fixtureOrigin = 'http://fixture:8080';
const locales = ['en', 'ar', 'fr', 'de', 'es'];
const widths = [360, 768, 1440];
const wordsFor = locale => JSON.parse(readFileSync(`/locales/${locale}/uptimeMonitor.json`, 'utf8'));
const en = wordsFor('en');
const secrets = new Set();
const errors = [];
let authRemaining = Infinity;
let authResetAt = 0;
const results = [];
const visualIssues = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let id;
let token;

mkdirSync('/evidence', { recursive: true });
for (const name of ['failure.txt', 'failure.png', 'accessibility.json', 'service-failure.log']) {
  rmSync(`/evidence/${name}`, { force: true });
}

function redact(value) {
  let output = String(value);
  for (const secret of secrets) output = output.split(secret).join('[REDACTED]');
  return output
    .replace(/https?:\/\/[^\s"'<>]*\/api\/heartbeat(?:\/[^\s"'<>]*)?/gi, '[REDACTED heartbeat URL]')
    .replace(/\/api\/heartbeat(?:\/[^\s"'<>]*)?/gi, '[REDACTED heartbeat path]')
    .replace(/((?:authorization|cookie|set-cookie)\s*[:=])[^\r\n]*/gi, '$1 [REDACTED]')
    .replace(/[A-Za-z0-9_-]{43,}/g, '[REDACTED]');
}

// Never retain capability paths, query strings, credentials or cookies in events.
function safePath(url) {
  const pathname = new URL(url).pathname;
  return pathname.startsWith('/api/heartbeat/') ? '[REDACTED heartbeat path]' : redact(pathname);
}

function writeEvidence(name, value) {
  writeFileSync(`/evidence/${name}`, redact(JSON.stringify(value, null, 2)));
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.on('pageerror', error => errors.push(redact(error.message)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(redact(message.text()));
});
page.on('response', response => {
  if (new URL(response.url()).pathname.startsWith('/api/auth/')) {
    const headers = response.headers();
    const remaining = Number(headers['x-ratelimit-remaining']);
    const resetAt = Number(headers['x-ratelimit-reset']) * 1000;
    if (Number.isFinite(remaining) && Number.isFinite(resetAt)) {
      authRemaining = resetAt === authResetAt ? Math.min(authRemaining, remaining) : remaining;
      authResetAt = resetAt;
    }
  }
  if (response.status() >= 400) errors.push(`${response.status()} ${safePath(response.url())}`);
});
page.on('requestfailed', request => {
  if (!request.failure()?.errorText.includes('ERR_ABORTED')) errors.push(`${safePath(request.url())} failed`);
});

// Respect the unchanged OSS auth budget during exhaustive full document loads.
// Reserve room for both the route session check and the mounted auth client.
async function waitForAuthBudget() {
  if (authRemaining < 3 && authResetAt > Date.now()) {
    await sleep(authResetAt - Date.now() + 1000);
  }
}
const navigate = page.goto.bind(page);
page.goto = async (url, ...args) => {
  if (String(url).startsWith(origin)) await waitForAuthBudget();
  return navigate(url, ...args);
};
const reload = page.reload.bind(page);
page.reload = async (...args) => {
  await waitForAuthBudget();
  return reload(...args);
};

async function until(fn, label, timeout = 250000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(1500);
  }
  throw Error(`Timed out: ${label}`);
}

async function fixture(path, data = {}) {
  const response = await context.request.post(fixtureOrigin + path, { data, timeout: 100000 });
  assert.equal(response.status(), 200, `fixture ${path}`);
  return response.json();
}

async function fixtureState() {
  const response = await context.request.get(fixtureOrigin + '/');
  assert.equal(response.status(), 200, 'fixture state');
  return response.json();
}

async function notifications() {
  const response = await context.request.get(fixtureOrigin + '/notifications');
  assert.equal(response.status(), 200, 'fixture notifications');
  return (await response.json()).events;
}

async function rpc(path, input, mutation = false) {
  const url = origin + '/api/trpc/uptimeMonitor.' + path;
  const response = mutation
    ? await context.request.post(url, { data: { json: input } })
    : await context.request.get(url + '?input=' + encodeURIComponent(JSON.stringify({ json: input })));
  assert.equal(response.status(), 200, `RPC ${path}`);
  return (await response.json()).result.data.json;
}

function record(step) {
  results.push({ step, time: new Date().toISOString() });
  console.log('PASS: ' + step);
  writeEvidence('results.json', { results });
}

async function screenshot(name) {
  // Commands render masked credentials today; also mask their whole regions so
  // a future installer display change cannot leak a one-time credential.
  await page.screenshot({
    path: `/evidence/${name}.png`, fullPage: true,
    mask: [page.locator('input[type="password"], input[readonly], pre[role="region"]')],
  });
}

async function audit(locale, width, name) {
  if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)) {
    visualIssues.push({ locale, width, name, issue: 'overflow' });
  }
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  if (accessibility.violations.length) {
    visualIssues.push({
      locale, width, name,
      violations: accessibility.violations.map(violation => ({
        id: violation.id,
        nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })),
      })),
    });
  }
  if (visualIssues.length) writeEvidence('accessibility.json', visualIssues);
}

const state = () => rpc('server.one', { monitorId: id });
const monitor = () => rpc('monitor.one', { uptimeMonitorId: id });
const status = value => until(async () => (await monitor()).status === value, 'status ' + value);
const memoryCondition = value => value.conditions.find(condition => condition.key === 'memory');
const rotationDialog = words => page.getByRole('dialog', { name: words.server.rotate, exact: true });
const settingsPanel = words => page.getByRole('tabpanel', { name: words.tabs.settings, exact: true });

try {
  await until(async () => {
    try { return (await context.request.get('http://server:4000/health')).ok(); } catch { return false; }
  }, 'API ready', 90000);
  await until(async () => {
    try { return (await context.request.get(origin + '/api/auth/get-session')).ok(); } catch { return false; }
  }, 'TLS proxy ready', 30000);

  const password = randomBytes(24).toString('base64url');
  secrets.add(password);
  const signup = await context.request.post(origin + '/api/auth/sign-up/email', {
    data: { name: 'Isolated acceptance', email: 'server-acceptance@example.test', password },
    headers: { Origin: origin },
  });
  assert.equal(signup.status(), 200, 'isolated signup');

  await page.goto(origin + '/dashboard?lng=en');
  await page.getByRole('button', { name: en.actions.chooseMonitorType, exact: true }).click();
  await page.getByRole('menuitem', { name: en.server.title, exact: true }).click();
  const creation = page.getByRole('dialog', { name: en.server.add, exact: true });
  await creation.getByLabel(en.server.name, { exact: true }).fill('Acceptance Linux');
  await creation.getByLabel(en.server.cpu + ' (%)', { exact: true }).fill('100');
  await creation.getByLabel(en.server.memory + ' (%)', { exact: true }).fill('90');
  await creation.getByLabel(en.server.disk + ' (%)', { exact: true }).fill('100');
  const createdResponse = page.waitForResponse(response =>
    response.url().includes('server.create') && response.request().method() === 'POST');
  await creation.getByRole('button', { name: en.server.create, exact: true }).click();
  const createdBody = await (await createdResponse).json();
  const created = (Array.isArray(createdBody) ? createdBody[0] : createdBody).result.data.json;
  id = created.monitor.uptimeMonitorId;
  token = created.token;
  secrets.add(token);
  assert.equal(await creation.getByLabel(en.server.credential, { exact: true }).getAttribute('type'), 'password');
  const command = creation.getByRole('region', { name: en.server.systemd, exact: true });
  await command.waitFor();
  assert.ok(!(await command.textContent()).includes(token), 'installer display masks credential');
  await screenshot('setup');
  await creation.getByRole('link', { name: en.server.open, exact: true }).click();
  const pending = await state();
  assert.equal(pending.lastReceivedAt, null);
  assert.equal(pending.interval, 60, 'real production reporting interval');
  assert.equal(pending.thresholds.memory, 90);
  record('Browser creation and masked, configured setup');

  await fixture('/install', { token });
  await until(async () => Boolean((await state()).latest), 'actual installed agent ingestion');
  const first = await state();
  assert.equal(first.latest.sample.cpuPercent, null);
  assert.ok(first.latest.sample.memoryPercent >= 0);
  assert.ok(first.latest.sample.uptimeSeconds > 0);
  assert.ok(first.latest.sample.filesystems.length > 0);
  await page.reload();
  await page.getByText(en.server.connected, { exact: true }).waitFor();
  record('Verified HTTPS installer → systemd agent → API → dashboard metrics');

  await rpc('channel.create', {
    uptimeMonitorId: id, channelType: 'webhook', webhookUrl: fixtureOrigin + '/notify',
    notifyOnDown: true, notifyOnDegraded: true, notifyOnRecovery: true,
    notifyOnTlsExpiry: false, tlsExpiryThresholdDays: 14,
  }, true);

  // Real authenticated views, setup commands, settings and rotation dialogs.
  for (const locale of locales) {
    const words = wordsFor(locale);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [
        ['dashboard', '/dashboard'],
        ['details', `/dashboard/uptime/${id}`],
        ['settings', `/dashboard/uptime/${id}?tab=settings`],
      ]) {
        await page.goto(origin + path + (path.includes('?') ? '&' : '?') + 'lng=' + locale);
        await page.waitForLoadState('networkidle');
        if (name === 'dashboard') {
          await page.getByRole('button', { name: words.actions.chooseMonitorType, exact: true }).waitFor();
        } else {
          await page.getByRole('heading', { name: 'Acceptance Linux', exact: true }).waitFor();
          if (name === 'settings') {
            await settingsPanel(words).getByRole('button', { name: words.server.rotate, exact: true }).waitFor();
          } else {
            await page.getByRole('region', { name: words.server.filesystems, exact: true }).waitFor();
          }
        }
        assert.equal(await page.locator('html').getAttribute('lang'), locale, `${locale} language`);
        assert.equal(await page.locator('html').getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr', `${locale} direction`);
        await audit(locale, width, name);
        await page.keyboard.press('Tab');
        assert.ok(await page.evaluate(() => document.activeElement !== document.body), 'keyboard focus');
        await screenshot(`${locale}-${width}-${name}`);
        if (name === 'settings') {
          await settingsPanel(words).getByRole('button', { name: words.server.rotate, exact: true }).click();
          const dialog = rotationDialog(words);
          await dialog.waitFor();
          await page.keyboard.press('Tab');
          assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'dialog keyboard focus');
          await audit(locale, width, 'rotation');
          await screenshot(`${locale}-${width}-rotation`);
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
        }
      }
    }
    if (!visualIssues.some(issue => issue.locale === locale)) {
      record(`${locale}: 360/768/1440 browser, keyboard, accessibility and overflow checks`);
    } else {
      console.log(`FINDINGS: ${locale} accessibility/overflow`);
    }
  }
  assert.deepEqual(visualIssues, [], 'Browser accessibility and overflow matrix');
  assert.deepEqual(errors, [], 'Browser console and failed requests before lifecycle');

  await fixture('/memory', { high: true });
  for (const streak of [1, 2]) {
    await until(async () => memoryCondition(await state()).violating >= streak, `high-memory report ${streak}`);
    const pendingPressure = memoryCondition(await state());
    assert.equal(pendingPressure.violating, streak, 'observe each real pressure report');
    assert.equal(pendingPressure.active, false, 'first two reports cannot activate pressure');
    assert.equal((await monitor()).status, 'up', 'pressure activates on the third report');
  }
  await status('degraded');
  const pressured = memoryCondition(await state());
  assert.equal(pressured.threshold, 90);
  assert.equal(pressured.active, true);
  assert.equal(pressured.violating, 3, 'three real RAM reports activate pressure');
  await until(async () => (await notifications()).length >= 1, 'pressure notification');
  assert.equal((await rpc('incident.list', { uptimeMonitorId: id }))[0].status, 'ongoing');
  record('Three real 60-second RAM reports → degraded incident and local webhook');

  // Suspend UI polling during the intentional backend outage. API requests still
  // verify restart and persistence; normal browser errors remain failures.
  await page.goto('about:blank');
  const before = await fixtureState();
  await fixture('/restart-backend');
  await until(async () => (await fixtureState()).generation > before.generation, 'backend restart');
  await until(async () => {
    try { return (await context.request.get('http://server:4000/health')).ok(); } catch { return false; }
  }, 'restarted API ready', 30000);
  assert.equal((await monitor()).status, 'degraded');
  assert.equal(memoryCondition(await state()).active, true, 'restart preserves active pressure condition');
  record('Backend restart preserves active condition');

  await fixture('/memory', { high: false });
  await status('up');
  const recovered = memoryCondition(await state());
  assert.equal(recovered.active, false);
  assert.equal(recovered.healthy, 2, 'two real healthy RAM reports clear pressure');
  record('Two healthy reports recover pressure');

  await fixture('/stop');
  await status('down');
  const missing = await state();
  assert.ok(Date.now() - Date.parse(missing.lastReceivedAt) >= 3 * 60 * 1000, 'three real missing intervals');
  record('Three missing intervals → down outage');
  await fixture('/start');
  await status('up');
  assert.equal(memoryCondition(await state()).healthy, 2, 'two real reports recover the missing-report outage');
  record('Restarted agent recovers missing-report outage after two reports');

  await page.goto(origin + `/dashboard/uptime/${id}?tab=settings&lng=en`);
  await settingsPanel(en).getByRole('button', { name: en.server.rotate, exact: true }).click();
  const rotation = rotationDialog(en);
  await rotation.getByRole('button', { name: en.server.confirmRotate, exact: true }).click();
  const credential = rotation.getByLabel(en.server.credential, { exact: true });
  await credential.waitFor();
  assert.equal(await credential.getAttribute('type'), 'password');
  const next = await credential.inputValue();
  secrets.add(next);
  assert.notEqual(next, token);
  // APIRequestContext keeps expected rejection out of page network errors.
  const old = await context.request.post(origin + '/api/agent/v1/metrics', {
    headers: { Authorization: 'Bearer ' + token }, data: (await state()).latest.sample,
  });
  assert.equal(old.status(), 401);
  await fixture('/rotate', { token: next });
  const previous = (await state()).lastReceivedAt;
  await until(async () => (await state()).lastReceivedAt !== previous, 'rotated report');
  await rotation.getByRole('button', { name: en.server.done, exact: true }).click();
  await rotation.waitFor({ state: 'hidden' });
  assert.equal(await page.getByLabel(en.server.credential, { exact: true }).count(), 0);
  record('Browser rotation revokes old token; installed agent reconnects');

  await until(async () => (await notifications()).length >= 4, 'four lifecycle notifications');
  const notices = await notifications();
  assert.equal(notices.length, 4, 'deduplicated pressure/recovery/missing/recovery deliveries');
  assert.deepEqual(notices.map(notice => notice.status), ['degraded', 'up', 'down', 'up']);
  assert.ok(notices.some(notice => JSON.stringify(notice).includes('90')), 'threshold in notification');

  // Teardown intentionally removes the monitor; stop its UI polling first.
  await page.goto('about:blank');
  await fixture('/stop');
  await rpc('monitor.delete', { uptimeMonitorId: id }, true);
  const deleted = await context.request.post(origin + '/api/agent/v1/metrics', {
    headers: { Authorization: 'Bearer ' + next }, data: first.latest.sample,
  });
  assert.equal(deleted.status(), 401);
  record('Deletion revokes agent and removes monitor');
  assert.deepEqual(errors, [], 'Browser console and failed requests');
  record('Acceptance complete');
} catch (error) {
  await screenshot('failure').catch(() => {});
  // Never persist page HTML, request bodies, traces, credentials or cookies.
  const failure = redact(error);
  writeFileSync('/evidence/failure.txt', failure);
  console.error(failure);
  process.exitCode = 1;
} finally {
  await browser.close();
}
