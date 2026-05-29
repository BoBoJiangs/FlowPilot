const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background.js', 'utf8');

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

test('background parses existing-account pool entries and selects the matching run account', () => {
  const bundle = [
    extractFunction('normalizeExistingAccountPoolEmail'),
    extractFunction('createExistingAccountPoolEntryId'),
    extractFunction('parseExistingAccountPoolLine'),
    extractFunction('normalizeExistingAccountPoolEntryObjects'),
    extractFunction('getExistingAccountPoolEntries'),
    extractFunction('getExistingAccountPoolEntryForRun'),
  ].join('\n');

  const api = new Function(`
${bundle}

return {
  normalizeExistingAccountPoolEntryObjects,
  getExistingAccountPoolEntries,
  getExistingAccountPoolEntryForRun,
};
`)();

  const entries = api.normalizeExistingAccountPoolEntryObjects(
    ` First@example.com----Secret123!
second@example.com,
invalid
first@example.com,ignored `
  );

  assert.equal(entries.length, 2);
  assert.equal(entries[0].email, 'first@example.com');
  assert.equal(entries[0].password, 'Secret123!');
  assert.equal(entries[1].email, 'second@example.com');
  assert.equal(entries[1].password, '');

  const state = {
    existingAccountPoolEntries: entries,
  };
  assert.equal(api.getExistingAccountPoolEntries(state).length, 2);
  assert.deepEqual(api.getExistingAccountPoolEntryForRun(state, 1), entries[0]);
  assert.deepEqual(api.getExistingAccountPoolEntryForRun(state, 2), entries[1]);
  assert.equal(api.getExistingAccountPoolEntryForRun(state, 3), null);
});

test('background fresh auto-run keep state injects existing-account pool credentials for the current round', () => {
  const bundle = [
    extractFunction('normalizeExistingAccountPoolEmail'),
    extractFunction('createExistingAccountPoolEntryId'),
    extractFunction('parseExistingAccountPoolLine'),
    extractFunction('normalizeExistingAccountPoolEntryObjects'),
    extractFunction('getExistingAccountPoolEntries'),
    extractFunction('getExistingAccountPoolEntryForRun'),
    extractFunction('buildFreshAutoRunKeepState'),
  ].join('\n');

  const api = new Function(`
const DEFAULT_ACTIVE_FLOW_ID = 'openai';
const self = {
  MultiPageFlowRegistry: {
    normalizeFlowId(value = '', fallback = DEFAULT_ACTIVE_FLOW_ID) {
      const normalized = String(value || '').trim().toLowerCase();
      return normalized || fallback;
    },
  },
};

function isPlainObjectValue(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function buildAutoRunFreshResetSettingsState(prevState = {}, activeFlowId = DEFAULT_ACTIVE_FLOW_ID) {
  return {
    activeFlowId,
    services: {
      account: {
        customPassword: prevState?.customPassword || '',
      },
    },
  };
}

function buildPersistentSettingsPayload(value = {}) {
  return {
    activeFlowId: value.activeFlowId,
    flowId: value.flowId,
    targetId: value.targetId,
    accountFlowMode: value.accountFlowMode,
    customPassword: value.customPassword,
    existingAccountPoolEntries: value.existingAccountPoolEntries,
    settingsState: value.settingsState,
  };
}

function collectAutoRunFreshResetRuntimeSettingKeys() {
  return new Set();
}

function getSettingsSchemaApi() {
  return {
    getSelectedTargetId() {
      return 'cpa';
    },
  };
}

const kiroStateHelpers = {};
const grokStateHelpers = {};

${bundle}

return {
  buildFreshAutoRunKeepState,
};
`)();

  const keepState = api.buildFreshAutoRunKeepState({
    activeFlowId: 'openai',
    flowId: 'openai',
    targetId: 'sub2api',
    accountFlowMode: 'existing_account_reauth',
    existingAccountPoolEntries: [
      { email: 'first@example.com', password: 'FirstSecret123!' },
      { email: 'second@example.com', password: '' },
    ],
    password: 'old-password',
    customPassword: 'old-custom-password',
  }, {
    targetRun: 2,
  });

  assert.equal(keepState.email, 'second@example.com');
  assert.equal(keepState.password, '');
  assert.equal(keepState.customPassword, '');
  assert.equal(keepState.accountIdentifierType, 'email');
  assert.equal(keepState.accountIdentifier, 'second@example.com');
  assert.equal(keepState.signupMethod, 'email');
  assert.equal(keepState.resolvedSignupMethod, 'email');
});
