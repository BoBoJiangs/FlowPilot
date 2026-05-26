// content/yahoo-mail.js — Content script for Yahoo Mail polling (steps 4, 7)
// Injected dynamically on: mail.yahoo.com

const YAHOO_MAIL_PREFIX = '[MultiPage:yahoo-mail]';
const YAHOO_SEEN_CODES_KEY = 'seenYahooCodes';
const YAHOO_FALLBACK_AFTER = 3;
const isTopFrame = window === window.top;

console.log(YAHOO_MAIL_PREFIX, 'Content script loaded on', location.href, 'frame:', isTopFrame ? 'top' : 'child');

if (!isTopFrame) {
  console.log(YAHOO_MAIL_PREFIX, 'Skipping child frame');
} else {

let seenCodes = new Set();

async function loadSeenCodes() {
  try {
    const data = await chrome.storage.session.get(YAHOO_SEEN_CODES_KEY);
    if (Array.isArray(data[YAHOO_SEEN_CODES_KEY])) {
      seenCodes = new Set(data[YAHOO_SEEN_CODES_KEY]);
      console.log(YAHOO_MAIL_PREFIX, `Loaded ${seenCodes.size} previously seen codes`);
    }
  } catch (err) {
    console.warn(YAHOO_MAIL_PREFIX, 'Session storage unavailable, using in-memory seen codes:', err?.message || err);
  }
}

async function persistSeenCodes() {
  try {
    await chrome.storage.session.set({ [YAHOO_SEEN_CODES_KEY]: [...seenCodes] });
  } catch (err) {
    console.warn(YAHOO_MAIL_PREFIX, 'Could not persist seen codes, continuing in-memory only:', err?.message || err);
  }
}

loadSeenCodes();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'POLL_EMAIL') {
    resetStopState();
    handlePollEmail(message.step, message.payload).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      if (isStopError(err)) {
        log(`步骤 ${message.step}：已被用户停止。`, 'warn');
        sendResponse({ stopped: true, error: err.message });
        return;
      }
      log(`步骤 ${message.step}：Yahoo 邮箱轮询失败：${err.message}`, 'warn');
      sendResponse({ error: err.message });
    });
    return true;
  }
});

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isDisplayed(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function isVisibleElement(element) {
  if (!isDisplayed(element)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function normalizeMinuteTimestamp(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  const date = new Date(timestamp);
  date.setSeconds(0, 0);
  return date.getTime();
}

function normalizeRulePatternList(patterns = []) {
  return Array.isArray(patterns) ? patterns : [];
}

function extractCodeByRulePatterns(text, patterns = []) {
  const normalizedText = String(text || '');
  for (const pattern of normalizeRulePatternList(patterns)) {
    try {
      const source = String(pattern?.source || '').trim();
      if (!source) {
        continue;
      }
      const flags = String(pattern?.flags || '').replace(/[^dgimsuvy]/g, '');
      const match = normalizedText.match(new RegExp(source, flags));
      if (!match) {
        continue;
      }
      for (let index = 1; index < match.length; index += 1) {
        const candidate = String(match[index] || '').trim();
        if (candidate) {
          return candidate;
        }
      }
      if (String(match[0] || '').trim()) {
        return String(match[0] || '').trim();
      }
    } catch (_) {
      // Ignore invalid runtime rule patterns and continue with other candidates.
    }
  }
  return null;
}

function getTargetEmailMatchState(text, targetEmail) {
  const normalizedTarget = String(targetEmail || '').trim().toLowerCase();
  if (!normalizedTarget) {
    return { matches: true, hasExplicitEmail: false };
  }

  const normalizedText = String(text || '').toLowerCase();
  if (normalizedText.includes(normalizedTarget)) {
    return { matches: true, hasExplicitEmail: true };
  }

  const atIndex = normalizedTarget.indexOf('@');
  if (atIndex > 0) {
    const encodedTarget = `${normalizedTarget.slice(0, atIndex)}=${normalizedTarget.slice(atIndex + 1)}`;
    if (normalizedText.includes(encodedTarget)) {
      return { matches: true, hasExplicitEmail: true };
    }
  }

  return { matches: false, hasExplicitEmail: false };
}

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

function parseYahooTimestampText(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  const parsedNative = Date.parse(text);
  if (Number.isFinite(parsedNative)) {
    return parsedNative;
  }

  let match = text.match(/(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  if (match) {
    const [, year, month, day, hourText, minute, meridiem] = match;
    let hour = Number(hourText);
    if (/pm/i.test(meridiem) && hour < 12) hour += 12;
    if (/am/i.test(meridiem) && hour === 12) hour = 0;
    return new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute), 0, 0).getTime();
  }

  match = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4}),?\s*(\d{1,2}):(\d{2})\s*([AP]M)\b/i);
  if (match) {
    const [, monthText, day, year, hourText, minute, meridiem] = match;
    const month = MONTH_INDEX_MAP[monthText.slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      let hour = Number(hourText);
      if (/pm/i.test(meridiem) && hour < 12) hour += 12;
      if (/am/i.test(meridiem) && hour === 12) hour = 0;
      return new Date(Number(year), month, Number(day), hour, Number(minute), 0, 0).getTime();
    }
  }

  match = text.match(/今天\s*(\d{1,2}):(\d{2})/);
  if (match) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]), 0, 0).getTime();
  }

  match = text.match(/昨天\s*(\d{1,2}):(\d{2})/);
  if (match) {
    const now = new Date();
    now.setDate(now.getDate() - 1);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]), 0, 0).getTime();
  }

  match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (match) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(match[1]), Number(match[2]), 0, 0).getTime();
  }

  match = text.match(/(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (match) {
    const now = new Date();
    let hour = Number(match[1]);
    if (/pm/i.test(match[3]) && hour < 12) hour += 12;
    if (/am/i.test(match[3]) && hour === 12) hour = 0;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, Number(match[2]), 0, 0).getTime();
  }

  match = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})\b/);
  if (match) {
    const month = MONTH_INDEX_MAP[match[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const now = new Date();
      return new Date(now.getFullYear(), month, Number(match[2]), 0, 0, 0, 0).getTime();
    }
  }

  return null;
}

function formatYahooTimestampForLog(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '无法解析';
  }
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
}

function shouldLogYahooRowDebug(preview = {}) {
  const combined = normalizeText(preview.combinedText || '').toLowerCase();
  return /chatgpt|openai|verify|verification|temporary|验证码|代码|code/.test(combined);
}

function extractVerificationCode(text, options = {}) {
  const normalized = String(text || '');
  const matchedByRule = extractCodeByRulePatterns(normalized, options?.codePatterns);
  if (matchedByRule) {
    return matchedByRule;
  }

  const cnMatch = normalized.match(/(?:验证码|代码)[^0-9]{0,16}(\d{6})/i);
  if (cnMatch) return cnMatch[1];

  const enMatch = normalized.match(/(?:verification\s+code|temporary\s+verification\s+code|log-?in\s+code|enter\s+this\s+code|code(?:\s+is)?)[^0-9]{0,24}(\d{6})/i);
  if (enMatch) return enMatch[1];

  const plainMatch = normalized.match(/\b(\d{6})\b/);
  if (plainMatch) return plainMatch[1];

  return null;
}

function findInboxLink() {
  const selectors = [
    'a[href*="/d/folders/1"]',
    '[data-test-id="folder-list-item_1"]',
    '[data-test-id="folder-list-item-inbox"]',
    '[data-test-folder-id="1"]',
    'a[aria-label*="Inbox"]',
    'a[title*="Inbox"]',
    'a[aria-label*="收件箱"]',
    'a[title*="收件箱"]',
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    const visible = candidates.find(isVisibleElement);
    if (visible) return visible;
    if (candidates[0]) return candidates[0];
  }

  return Array.from(document.querySelectorAll('a, [role="link"], [role="button"]')).find((element) => {
    const text = normalizeText(
      element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.textContent
    );
    return /收件箱|Inbox/i.test(text);
  }) || null;
}

function findRefreshButton() {
  const selectors = [
    'button[data-test-id="toolbar-refresh"]',
    '[data-test-id*="refresh"]',
    'button[aria-label*="Refresh"]',
    'button[title*="Refresh"]',
    '[role="button"][aria-label*="Refresh"]',
    '[role="button"][title*="Refresh"]',
    'button[aria-label*="刷新"]',
    'button[title*="刷新"]',
    '[role="button"][aria-label*="刷新"]',
    '[role="button"][title*="刷新"]',
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    const visible = candidates.find(isVisibleElement);
    if (visible) return visible;
  }

  return Array.from(document.querySelectorAll('button, [role="button"]')).find((element) => {
    const text = normalizeText(
      element.getAttribute('aria-label')
      || element.getAttribute('title')
      || element.textContent
    );
    return /刷新|Refresh/i.test(text);
  }) || null;
}

function findMessageListContainer() {
  const selectors = [
    '[data-test-id="virtual-list"]',
    '[data-test-id*="virtual-list"]',
    '[data-test-id="message-list"]',
    '[data-test-id*="message-list"]',
    '[role="main"] ul',
    'main ul',
  ];

  for (const selector of selectors) {
    const candidates = Array.from(document.querySelectorAll(selector));
    const visible = candidates.find(isVisibleElement);
    if (visible) {
      return visible;
    }
  }

  return null;
}

function isLikelyMessageRow(element) {
  if (!isVisibleElement(element)) {
    return false;
  }

  const text = normalizeText(
    element.getAttribute('aria-label')
    || element.getAttribute('title')
    || element.textContent
  );
  if (!text) {
    return false;
  }

  if (
    element.querySelector?.('[data-test-id*="subject"], [data-test-id*="snippet"], [data-test-id*="sender"], time')
    || element.matches?.('[data-test-id*="message"]')
    || element.closest?.('[data-test-id="virtual-list"], [data-test-id*="virtual-list"]')
  ) {
    return true;
  }

  return /verification|code|验证码|log-?in/i.test(text);
}

function collectMessageRows() {
  const selectors = [
    '[data-test-id="virtual-list"] li',
    '[data-test-id*="virtual-list"] li',
    '[data-test-id="virtual-list"] [role="listitem"]',
    '[data-test-id*="virtual-list"] [role="listitem"]',
    'main [role="listitem"]',
    '[data-test-id="message-list-item"]',
    '[data-test-id*="message-list-item"]',
    'li[data-test-id*="message"]',
    '[role="row"][data-test-id*="message"]',
    'li[role="row"]',
    '[aria-label][role="row"]',
    'main li',
  ];

  for (const selector of selectors) {
    const rows = Array.from(document.querySelectorAll(selector)).filter(isLikelyMessageRow);
    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function getRowTextBySelectors(row, selectors = []) {
  for (const selector of selectors) {
    const candidates = row.querySelectorAll(selector);
    for (const candidate of candidates) {
      const texts = [
        candidate.getAttribute?.('title'),
        candidate.getAttribute?.('aria-label'),
        candidate.textContent,
      ];
      for (const text of texts) {
        const normalized = normalizeText(text);
        if (normalized) {
          return normalized;
        }
      }
    }
  }
  return '';
}

function getMessageRowPreview(row) {
  const rowText = normalizeText(row.textContent || row.innerText || '');
  const sender = getRowTextBySelectors(row, [
    '[data-test-id="sender"]',
    '[data-test-id*="sender"]',
    '[aria-label*="From"]',
    '[title*="@"]',
  ]);

  const subject = getRowTextBySelectors(row, [
    '[data-test-id="message-subject"]',
    '[data-test-id*="subject"]',
    '[data-test-id="thread-subject"]',
    'strong',
  ]);

  const snippet = getRowTextBySelectors(row, [
    '[data-test-id="message-snippet"]',
    '[data-test-id*="snippet"]',
    '[data-test-id*="preview"]',
    '[data-test-id*="message-body"]',
  ]);

  const timeText = getRowTextBySelectors(row, [
    'time',
    '[data-test-id="message-date"]',
    '[data-test-id*="date"]',
  ]) || (rowText.match(/\d{1,2}:\d{2}\s*[AP]M/i)?.[0] || rowText.match(/[A-Za-z]{3,9}\s+\d{1,2}/)?.[0] || '');

  const fullText = rowText;

  return {
    sender,
    subject,
    snippet,
    timeText,
    fullText,
    combinedText: normalizeText([sender, subject, snippet, timeText, fullText].filter(Boolean).join(' ')),
  };
}

function getMessageRowTimestamp(row) {
  const preview = getMessageRowPreview(row);
  return parseYahooTimestampText(preview.timeText);
}

function getMessageRowId(row, index = 0) {
  const id = row.getAttribute('data-id')
    || row.getAttribute('data-test-id')
    || row.getAttribute('id')
    || row.dataset?.id
    || row.querySelector?.('a[href]')?.getAttribute?.('href')
    || `row-${index}`;
  const preview = getMessageRowPreview(row);
  return `${id}::${preview.subject}::${preview.timeText}`.slice(0, 320);
}

function getCurrentMailIds(rows = []) {
  const ids = new Set();
  const sourceRows = rows.length > 0 ? rows : collectMessageRows();
  sourceRows.forEach((row, index) => {
    ids.add(getMessageRowId(row, index));
  });
  return ids;
}

function rowMatchesFilters(preview, senderFilters = [], subjectFilters = []) {
  const senderText = normalizeText(preview.sender).toLowerCase();
  const subjectText = normalizeText(preview.subject).toLowerCase();
  const combinedText = normalizeText(preview.combinedText).toLowerCase();

  const senderMatch = senderFilters.some((filter) => {
    const value = String(filter || '').toLowerCase();
    return value && (senderText.includes(value) || combinedText.includes(value));
  });

  const subjectMatch = subjectFilters.some((filter) => {
    const value = String(filter || '').toLowerCase();
    return value && (subjectText.includes(value) || combinedText.includes(value));
  });

  return senderMatch || subjectMatch;
}

async function ensureInboxReady(step) {
  const existingRows = collectMessageRows();
  if (existingRows.length > 0) {
    return existingRows;
  }

  const hasListContainer = Boolean(findMessageListContainer());
  if (!hasListContainer && !/\/d\/folders\/1(?:[/?#]|$)/i.test(location.pathname + location.hash)) {
    const inboxLink = findInboxLink();
    if (inboxLink) {
      simulateClick(inboxLink);
      await sleep(1000);
      log(`步骤 ${step}：已切回 Yahoo 收件箱。`);
    }
  }

  for (let i = 0; i < 20; i += 1) {
    const rows = collectMessageRows();
    if (rows.length > 0) {
      return rows;
    }
    await sleep(400);
  }

  return [];
}

async function refreshInbox(step) {
  const existingRows = collectMessageRows();
  if (existingRows.length > 0) {
    const refreshButton = findRefreshButton();
    if (refreshButton) {
      simulateClick(refreshButton);
      log(`步骤 ${step}：已点击 Yahoo 刷新。`);
      await sleep(1500);
      return;
    }
  }

  const refreshButton = findRefreshButton();
  if (refreshButton) {
    simulateClick(refreshButton);
    log(`步骤 ${step}：已点击 Yahoo 刷新。`);
    await sleep(1500);
    return;
  }

  const inboxLink = findInboxLink();
  if (inboxLink) {
    simulateClick(inboxLink);
    log(`步骤 ${step}：未找到刷新按钮，已重新进入 Yahoo 收件箱。`);
    await sleep(1200);
    return;
  }

  location.reload();
  log(`步骤 ${step}：未找到刷新按钮，已直接刷新页面。`);
  await sleep(2500);
}

async function returnToInbox() {
  if (collectMessageRows().length > 0) {
    return;
  }

  const inboxLink = findInboxLink();
  if (inboxLink) {
    simulateClick(inboxLink);
  } else {
    location.assign(`${location.origin}/d/folders/1`);
  }

  for (let i = 0; i < 20; i += 1) {
    if (collectMessageRows().length > 0) {
      return;
    }
    await sleep(300);
  }
}

async function openRowAndGetMessageText(row) {
  row.scrollIntoView?.({ block: 'center' });
  const clickable = row.querySelector?.('a[href], [role="link"], [role="button"]') || row;
  simulateClick(clickable);

  for (let i = 0; i < 20; i += 1) {
    const messageView = document.querySelector('[data-test-id="message-view-body"], [data-test-id*="message-view"], main, article');
    if (messageView || !/\/d\/folders\/1(?:[/?#]|$)/i.test(location.pathname + location.hash)) {
      break;
    }
    await sleep(250);
  }

  await sleep(900);
  const text = normalizeText(
    document.querySelector('[data-test-id="message-view-body"], [data-test-id*="message-view"], main, article')?.innerText
    || document.body?.innerText
    || document.body?.textContent
    || ''
  );
  await returnToInbox();
  return text;
}

async function handlePollEmail(step, payload) {
  const {
    codePatterns = [],
    senderFilters = [],
    subjectFilters = [],
    maxAttempts = 5,
    intervalMs = 3000,
    filterAfterTimestamp = 0,
    excludeCodes = [],
    targetEmail = '',
  } = payload || {};

  const excludedCodeSet = new Set(excludeCodes.filter(Boolean));
  const filterAfterMinute = normalizeMinuteTimestamp(Number(filterAfterTimestamp) || 0);

  log(`步骤 ${step}：开始轮询 Yahoo 邮箱（最多 ${maxAttempts} 次）`);
  if (filterAfterMinute) {
    log(`步骤 ${step}：仅尝试 ${new Date(filterAfterMinute).toLocaleString('zh-CN', { hour12: false })} 及之后时间的邮件。`);
  }

  let initialRows = await ensureInboxReady(step);
  if (!initialRows.length) {
    await refreshInbox(step);
    initialRows = await ensureInboxReady(step);
  }

  if (!initialRows.length) {
    throw new Error('Yahoo 收件箱列表未加载完成，请确认当前已打开 Yahoo Mail 收件箱。');
  }

  const existingMailIds = getCurrentMailIds(initialRows);
  log(`步骤 ${step}：已记录 Yahoo 收件箱的 ${existingMailIds.size} 封旧邮件快照`);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log(`步骤 ${step}：正在轮询 Yahoo 邮箱，第 ${attempt}/${maxAttempts} 次`);

    if (attempt > 1) {
      await refreshInbox(step);
    }

    const rows = collectMessageRows();
    log(`步骤 ${step}：Yahoo 当前页面检测到 ${rows.length} 个可见列表项。`);
    const useFallback = attempt > YAHOO_FALLBACK_AFTER;
    let rowDebugCount = 0;

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowId = getMessageRowId(row, index);
      const preview = getMessageRowPreview(row);
      const rowTimestamp = parseYahooTimestampText(preview.timeText);
      const rowMinute = normalizeMinuteTimestamp(rowTimestamp || 0);
      const passesTimeFilter = !filterAfterMinute || (rowMinute && rowMinute >= filterAfterMinute);
      const shouldBypassOldSnapshot = Boolean(filterAfterMinute && passesTimeFilter && rowMinute > 0);
      const matchesFilters = rowMatchesFilters(preview, senderFilters, subjectFilters);
      const previewTargetState = getTargetEmailMatchState(preview.combinedText, targetEmail);
      const previewCode = extractVerificationCode(preview.combinedText, {
        codePatterns,
      });

      if (rowDebugCount < 4 && shouldLogYahooRowDebug(preview)) {
        rowDebugCount += 1;
        log(
          `步骤 ${step}：Yahoo 调试候选 ${rowDebugCount}，发件人：${preview.sender || '未知'}，主题：${(preview.subject || preview.snippet || preview.fullText || '').slice(0, 40)}，时间文本：${preview.timeText || '无'}，解析时间：${formatYahooTimestampForLog(rowTimestamp)}，时间命中：${passesTimeFilter ? '是' : '否'}，规则命中：${matchesFilters ? '是' : '否'}，预览提码：${previewCode || '无'}，目标邮箱命中：${previewTargetState.matches ? '是' : '否'}。`,
          'info'
        );
      }

      if (!passesTimeFilter) {
        continue;
      }

      if (!useFallback && !shouldBypassOldSnapshot && existingMailIds.has(rowId)) {
        continue;
      }

      if (!matchesFilters) {
        continue;
      }

      if (previewCode) {
        if (excludedCodeSet.has(previewCode)) {
          log(`步骤 ${step}：跳过排除的验证码：${previewCode}`, 'info');
          continue;
        }
        if (seenCodes.has(previewCode)) {
          log(`步骤 ${step}：跳过已处理过的验证码：${previewCode}`, 'info');
          continue;
        }
        seenCodes.add(previewCode);
        persistSeenCodes();
        const source = useFallback && existingMailIds.has(rowId) ? '回退匹配邮件' : '新邮件';
        const timeLabel = rowTimestamp ? `，时间：${new Date(rowTimestamp).toLocaleString('zh-CN', { hour12: false })}` : '';
        const targetLabel = previewTargetState.matches ? '，目标邮箱命中' : '';
        log(`步骤 ${step}：已在 Yahoo 邮箱中找到验证码：${previewCode}（来源：${source}${timeLabel}${targetLabel}）`, 'ok');
        return {
          ok: true,
          code: previewCode,
          emailTimestamp: Date.now(),
          mailId: rowId,
        };
      }

      const openedText = await openRowAndGetMessageText(row);
      const openedTargetState = getTargetEmailMatchState(openedText, targetEmail);
      const bodyCode = extractVerificationCode(openedText, {
        codePatterns,
      });
      if (!bodyCode) {
        continue;
      }
      if (excludedCodeSet.has(bodyCode)) {
        log(`步骤 ${step}：跳过排除的验证码：${bodyCode}`, 'info');
        continue;
      }
      if (seenCodes.has(bodyCode)) {
        log(`步骤 ${step}：跳过已处理过的验证码：${bodyCode}`, 'info');
        continue;
      }
      seenCodes.add(bodyCode);
      persistSeenCodes();
      const source = useFallback && existingMailIds.has(rowId) ? '回退匹配邮件正文' : '新邮件正文';
      const timeLabel = rowTimestamp ? `，时间：${new Date(rowTimestamp).toLocaleString('zh-CN', { hour12: false })}` : '';
      const targetLabel = openedTargetState.matches ? '，目标邮箱命中' : '';
      log(`步骤 ${step}：已在 Yahoo 邮件正文中找到验证码：${bodyCode}（来源：${source}${timeLabel}${targetLabel}）`, 'ok');
      return {
        ok: true,
        code: bodyCode,
        emailTimestamp: Date.now(),
        mailId: rowId,
      };
    }

    if (attempt === YAHOO_FALLBACK_AFTER + 1) {
      log(`步骤 ${step}：连续 ${YAHOO_FALLBACK_AFTER} 次未发现新邮件，开始回退到首封匹配邮件`, 'warn');
    }

    if (attempt < maxAttempts) {
      await sleep(intervalMs);
    }
  }

  throw new Error(
    `${(maxAttempts * intervalMs / 1000).toFixed(0)} 秒后仍未在 Yahoo 邮箱中找到匹配邮件。请手动检查 Yahoo 收件箱。`
  );
}

}
