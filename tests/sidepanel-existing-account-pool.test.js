const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const source = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => source.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }
  if (braceStart < 0) {
    throw new Error(`missing body for function ${name}`);
  }

  let depth = 0;
  let end = braceStart;
  for (; end < source.length; end += 1) {
    const ch = source[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return source.slice(start, end);
}

test('sidepanel html exposes existing-account reauth pool editor', () => {
  assert.match(html, /id="row-existing-account-pool"/);
  assert.match(html, /id="input-existing-account-pool"/);
  assert.match(html, /id="btn-existing-account-pool-apply"/);
  assert.match(html, /id="btn-existing-account-pool-import"/);
  assert.match(html, /id="btn-existing-account-pool-delete-all"/);
  assert.match(html, /id="checkbox-existing-account-pool-select-all"/);
  assert.match(html, /id="btn-existing-account-pool-bulk-delete"/);
  assert.match(html, /id="input-existing-account-pool-import"/);
  assert.match(html, /id="input-existing-account-pool-search"/);
  assert.match(html, /id="select-existing-account-pool-filter"/);
  assert.match(html, /id="existing-account-pool-preview"/);
  assert.match(html, /重新授权账号池/);
});

test('sidepanel reauth account pool locks run count and formats textarea entries', () => {
  const bundle = [
    extractFunction('normalizeFlowId'),
    extractFunction('normalizeAccountFlowMode'),
    extractFunction('getSelectedAccountFlowMode'),
    extractFunction('isExistingAccountReauthMode'),
    extractFunction('normalizeExistingAccountPoolEmail'),
    extractFunction('createExistingAccountPoolEntryId'),
    extractFunction('parseExistingAccountPoolLine'),
    extractFunction('normalizeExistingAccountPoolEntryObjects'),
    extractFunction('formatExistingAccountPoolEntriesForTextarea'),
    extractFunction('getExistingAccountPoolEntriesFromInput'),
    extractFunction('getPersistedExistingAccountPoolEntries'),
    extractFunction('getExistingAccountPoolSize'),
    extractFunction('getLockedRunCountFromEmailPool'),
    extractFunction('getRunCountValue'),
  ].join('\n');

  const api = new Function(`
const ACCOUNT_FLOW_MODE_SIGNUP = 'signup';
const ACCOUNT_FLOW_MODE_EXISTING_ACCOUNT_REAUTH = 'existing_account_reauth';
const DEFAULT_ACCOUNT_FLOW_MODE = ACCOUNT_FLOW_MODE_SIGNUP;
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
const latestState = {
  activeFlowId: 'openai',
  accountFlowMode: 'existing_account_reauth',
  existingAccountPoolEntries: [
    { email: 'first@example.com', password: 'Secret123!' },
    { email: 'second@example.com', password: '' },
  ],
};
const selectAccountFlowMode = { value: 'existing_account_reauth' };
const selectMailProvider = { value: 'gmail' };
const inputExistingAccountPool = {
  value: 'draft@example.com----DraftSecret123!',
};
const inputRunCount = { value: '99' };

function getFlowRegistry() {
  return null;
}

function usesCustomMailProviderPool() {
  return false;
}

function usesCustomEmailPoolGenerator() {
  return false;
}

function getCustomMailProviderPoolSize() {
  return 0;
}

function getCustomEmailPoolSize() {
  return 0;
}

${bundle}

return {
  normalizeExistingAccountPoolEntryObjects,
  formatExistingAccountPoolEntriesForTextarea,
  getExistingAccountPoolSize,
  getLockedRunCountFromEmailPool,
  getRunCountValue,
};
`)();

  const normalizedEntries = api.normalizeExistingAccountPoolEntryObjects(`first@example.com----Secret123!
second@example.com`);
  assert.equal(normalizedEntries.length, 2);
  assert.equal(normalizedEntries[0].email, 'first@example.com');
  assert.equal(normalizedEntries[0].password, 'Secret123!');
  assert.equal(normalizedEntries[1].password, '');
  assert.equal(
    api.formatExistingAccountPoolEntriesForTextarea(normalizedEntries),
    `first@example.com----Secret123!
second@example.com`
  );
  assert.equal(api.getExistingAccountPoolSize(), 2);
  assert.equal(api.getLockedRunCountFromEmailPool(), 2);
  assert.equal(api.getRunCountValue(), 2);
});

test('sidepanel previews auto-detected mailbox providers for reauth account pool entries', () => {
  const bundle = [
    extractFunction('normalizeExistingAccountPoolEmail'),
    extractFunction('createExistingAccountPoolEntryId'),
    extractFunction('parseExistingAccountPoolLine'),
    extractFunction('normalizeExistingAccountPoolEntryObjects'),
    extractFunction('getExistingAccountPoolEntriesFromInput'),
    extractFunction('getPersistedExistingAccountPoolEntries'),
    extractFunction('normalizeExistingAccountPoolEmailDomain'),
    extractFunction('normalizeExistingAccountPoolDomainSet'),
    extractFunction('getExistingAccountPoolMailboxProviderLabel'),
    extractFunction('resolveExistingAccountPoolMailboxProvider'),
    extractFunction('normalizeExistingAccountPoolHistoryRecordEmail'),
    extractFunction('normalizeExistingAccountPoolHistoryTimestamp'),
    extractFunction('normalizeExistingAccountPoolRecordStatus'),
    extractFunction('getExistingAccountPoolRecordPhoneNumber'),
    extractFunction('isExistingAccountPoolRecordPhoneCodeReceived'),
    extractFunction('isExistingAccountPoolRecordPhoneVerified'),
    extractFunction('getExistingAccountPoolRecordPhoneState'),
    extractFunction('isExistingAccountPoolAutoRunDisplayRunning'),
    extractFunction('resolveExistingAccountPoolCurrentEmail'),
    extractFunction('getExistingAccountPoolLatestHistoryRecordMap'),
    extractFunction('formatExistingAccountPoolRecordTime'),
    extractFunction('getExistingAccountPoolStatusMeta'),
    extractFunction('getExistingAccountPoolStatusSummary'),
    extractFunction('buildExistingAccountPoolPreviewEntries'),
  ].join('\n');

  const api = new Function(`
const latestState = {
  mailProvider: 'qq',
  email: 'first@gmail.com',
  cloudflareTempEmailDomain: 'relay.example',
  cloudMailDomain: 'mailbox.example',
  existingAccountPoolEntries: [
    { email: 'first@gmail.com', password: 'Secret123!' },
    { email: 'second@relay.example', password: '' },
    { email: 'third@unknown.example', password: '' },
  ],
  accountRunHistory: [
    {
      email: 'first@gmail.com',
      plusModeEnabled: true,
      phoneNumber: '+15551230001',
      phoneCodeReceived: true,
      phoneVerificationSucceeded: true,
      finalStatus: 'success',
      finishedAt: '2026-05-28T08:00:00.000Z',
    },
    {
      email: 'second@relay.example',
      plusModeEnabled: false,
      phoneNumber: '+15551239999',
      phoneCodeReceived: true,
      finalStatus: 'stopped',
      failureDetail: '节点 post-login-phone-verification 已被用户停止。',
      finishedAt: '2026-05-28T07:30:00.000Z',
    },
    {
      email: 'legacy-third@relay.example',
      plusModeEnabled: false,
      finalStatus: 'failed',
      failureDetail: '验证码已失效',
      finishedAt: '2026-05-28T07:20:00.000Z',
    },
  ],
};
const selectMailProvider = { value: 'qq' };
const inputExistingAccountPool = {
  value: 'draft@example.com----DraftSecret123!',
};
${bundle}
return {
  resolveExistingAccountPoolMailboxProvider,
  buildExistingAccountPoolPreviewEntries,
};
`)();

  const previewEntries = api.buildExistingAccountPoolPreviewEntries();
  assert.equal(previewEntries.length, 3);
  assert.deepEqual(previewEntries.map((entry) => ({
    email: entry.email,
    loginModeLabel: entry.loginModeLabel,
    providerLabel: entry.providerLabel,
    providerDetected: entry.providerDetected,
    providerFallback: entry.providerFallback,
    tierLabel: entry.tierLabel,
    phoneLabel: entry.phoneLabel,
    phoneNumber: entry.phoneNumber,
    statusLabel: entry.statusLabel,
    current: entry.current,
  })), [
    {
      email: 'first@gmail.com',
      loginModeLabel: '密码登录',
      providerLabel: 'Gmail 邮箱',
      providerDetected: true,
      providerFallback: false,
      tierLabel: 'Plus',
      phoneLabel: '验证成功',
      phoneNumber: '+15551230001',
      statusLabel: '成功',
      current: true,
    },
    {
      email: 'second@relay.example',
      loginModeLabel: '验证码登录',
      providerLabel: 'Cloudflare Temp Email',
      providerDetected: true,
      providerFallback: false,
      tierLabel: 'Free',
      phoneLabel: '已接码未成功',
      phoneNumber: '+15551239999',
      statusLabel: '停止',
      current: false,
    },
    {
      email: 'third@unknown.example',
      loginModeLabel: '验证码登录',
      providerLabel: 'QQ 邮箱',
      providerDetected: false,
      providerFallback: true,
      tierLabel: '未判定',
      phoneLabel: '待运行',
      phoneNumber: '',
      statusLabel: '未运行',
      current: false,
    },
  ]);
  assert.match(previewEntries[2].note, /沿用已保存邮箱服务：QQ 邮箱/);
  assert.match(previewEntries[1].historyNote, /post-login-phone-verification 已被用户停止/);
});

test('sidepanel existing-account pool payload is persisted with settings', () => {
  assert.match(source, /existingAccountPoolEntries:\s*normalizedExistingAccountPoolEntries,/);
  assert.match(source, /rowExistingAccountPool\.style\.display = existingAccountReauthMode \? '' : 'none';/);
  assert.match(source, /rowMailProvider\.style\.display = existingAccountReauthMode \? 'none' : '';/);
  assert.match(source, /rowCustomMailProviderPool\.style\.display = !existingAccountReauthMode && useCustomEmail \? '' : 'none';/);
  assert.match(source, /renderExistingAccountPoolPreview\(latestState\);/);
  assert.match(source, /btnExistingAccountPoolApply\?\.addEventListener\('click'/);
  assert.match(source, /btnExistingAccountPoolBulkDelete\?\.addEventListener\('click'/);
  assert.match(source, /btnExistingAccountPoolDeleteAll\?\.addEventListener\('click'/);
  assert.match(source, /normalizeExistingAccountPoolEntryObjects\(latestState\?\.existingAccountPoolEntries \|\| \[\]\)/);
  assert.doesNotMatch(source, /inputExistingAccountPool\?\.addEventListener\('input',[\s\S]{0,220}saveSettings/);
});

test('sidepanel existing-account reauth save preserves hidden signup settings', () => {
  assert.match(source, /const existingAccountReauthMode = selectedAccountFlowMode === ACCOUNT_FLOW_MODE_EXISTING_ACCOUNT_REAUTH;/);
  assert.match(
    source,
    /customPassword:\s*existingAccountReauthMode\s*\?\s*String\(latestState\?\.customPassword \|\| ''\)\s*:\s*inputPassword\.value/
  );
  assert.match(
    source,
    /mailProvider:\s*existingAccountReauthMode\s*\?\s*\(String\(latestState\?\.mailProvider \|\| selectMailProvider\.value \|\| ''\)\.trim\(\) \|\| '163'\)\s*:\s*selectMailProvider\.value/
  );
});
