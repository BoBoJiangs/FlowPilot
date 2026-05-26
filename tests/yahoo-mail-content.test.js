const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('content/yahoo-mail.js', 'utf8');

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

test('yahoo extractVerificationCode supports runtime mail rule patterns', () => {
  const bundle = [
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('extractVerificationCode'),
  ].join('\n');

  const api = new Function(`
${bundle}
return { extractVerificationCode };
`)();

  assert.equal(
    api.extractVerificationCode('Yahoo alert: use pin Y-441122 to continue.', {
      codePatterns: [{ source: 'pin\\s+Y-(\\d{6})', flags: 'i' }],
    }),
    '441122'
  );
});

test('yahoo parseYahooTimestampText can extract embedded PM time from message rows', () => {
  const bundle = [extractFunction('normalizeText'), extractFunction('parseYahooTimestampText')].join('\n');

  const api = new Function(`
const MONTH_INDEX_MAP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
${bundle}
return { parseYahooTimestampText };
`)();

  const parsed = api.parseYahooTimestampText('Unread message ChatGPT 3:22 PM 你的 ChatGPT 临时验证码');
  assert.equal(Number.isFinite(parsed), true);
});

test('yahoo parseYahooTimestampText can extract PM time when Yahoo row text is glued together', () => {
  const bundle = [extractFunction('normalizeText'), extractFunction('parseYahooTimestampText')].join('\n');

  const api = new Function(`
const MONTH_INDEX_MAP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
${bundle}
return { parseYahooTimestampText };
`)();

  const parsed = api.parseYahooTimestampText('Unread messageChatGPT3:46 PM你的 ChatGPT 临时验证码');
  assert.equal(Number.isFinite(parsed), true);
});

test('yahoo handlePollEmail forwards runtime code patterns to message matching', async () => {
  const bundle = [
    extractFunction('normalizeText'),
    extractFunction('normalizeMinuteTimestamp'),
    extractFunction('normalizeRulePatternList'),
    extractFunction('extractCodeByRulePatterns'),
    extractFunction('getTargetEmailMatchState'),
    extractFunction('parseYahooTimestampText'),
    extractFunction('formatYahooTimestampForLog'),
    extractFunction('shouldLogYahooRowDebug'),
    extractFunction('extractVerificationCode'),
    extractFunction('handlePollEmail'),
  ].join('\n');

  const api = new Function(`
const MONTH_INDEX_MAP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
let currentRows = [
  createRow('old-mail', {
    sender: 'alerts@yahoo.com',
    subject: 'Earlier message',
    snippet: 'No code here',
    timeText: '2026-05-21 10:00',
    fullText: 'Earlier message without verification code',
    combinedText: 'Earlier message without verification code',
  }, Date.parse('2026-05-21T10:00:00+08:00')),
];
let refreshCount = 0;
let seenCodes = new Set();
const YAHOO_FALLBACK_AFTER = 3;

function createRow(id, preview, timestamp) {
  return { id, preview, timestamp };
}

async function ensureInboxReady() {
  return currentRows;
}
async function refreshInbox() {
  refreshCount += 1;
  if (refreshCount >= 1) {
    currentRows = [
      createRow('old-mail', {
        sender: 'alerts@yahoo.com',
        subject: 'Earlier message',
        snippet: 'No code here',
        timeText: '2026-05-21 10:00',
        fullText: 'Earlier message without verification code',
        combinedText: 'Earlier message without verification code',
      }, Date.parse('2026-05-21T10:00:00+08:00')),
      createRow('mail-1', {
        sender: 'alerts@yahoo.com',
        subject: 'Security center',
        snippet: 'Use pin Y-551188 to continue',
        timeText: '2026-05-21 10:08',
        fullText: 'alerts@yahoo.com Security center Use pin Y-551188 to continue',
        combinedText: 'alerts@yahoo.com Security center Use pin Y-551188 to continue',
      }, Date.parse('2026-05-21T10:08:00+08:00')),
    ];
  }
}
function collectMessageRows() {
  return currentRows;
}
function getMessageRowId(row) {
  return row.id;
}
function getMessageRowTimestamp(row) {
  return row.timestamp;
}
function getMessageRowPreview(row) {
  return row.preview;
}
function rowMatchesFilters(preview, senderFilters, subjectFilters) {
  const senderText = String(preview.sender || '').toLowerCase();
  const subjectText = String(preview.subject || '').toLowerCase();
  const combinedText = String(preview.combinedText || '').toLowerCase();
  return senderFilters.some((filter) => senderText.includes(String(filter || '').toLowerCase()) || combinedText.includes(String(filter || '').toLowerCase()))
    || subjectFilters.some((filter) => subjectText.includes(String(filter || '').toLowerCase()) || combinedText.includes(String(filter || '').toLowerCase()));
}
function getCurrentMailIds(rows = []) {
  return new Set(rows.map((row) => row.id));
}
async function openRowAndGetMessageText(row) {
  return row.preview.combinedText;
}
async function persistSeenCodes() {}
async function sleep() {}
function log() {}

${bundle}

return { handlePollEmail };
`)();

  const result = await api.handlePollEmail(4, {
    senderFilters: ['alerts'],
    subjectFilters: ['security'],
    maxAttempts: 2,
    intervalMs: 1,
    codePatterns: [{ source: 'pin\\s+Y-(\\d{6})', flags: 'i' }],
  });

  assert.equal(result.code, '551188');
});
