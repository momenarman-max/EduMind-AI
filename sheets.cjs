const { sign } = require('node:crypto');
const { readObservations } = require('./detection.js');
const { readDiagnosisEvidence } = require('./diagnosis.js');

const tokenUrl = 'https://oauth2.googleapis.com/token';
const tabs = ['Measurements', 'Transport', 'FollowUp'];
const ranges = ['Measurements!A2:F5001', 'Transport!A2:D5001', 'FollowUp!A2:I5001'];
const validCode = /^[A-Z0-9_-]{3,24}$/;
const isCode = code => typeof code === 'string' && validCode.test(code);

function readRows(values) {
  const measurements = new Map();
  const transport = new Map();
  const logged = new Set();
  const key = (code, week) => code + ':' + week;
  for (const [code, week, mathScore, attendedDays, correct, total] of values[0]) {
    if (!code) continue;
    if (!isCode(code) || !Number.isInteger(week) || week < 0 || week > 8) throw new Error('Invalid measurement key');
    if (mathScore === '' || mathScore == null || attendedDays === '' || attendedDays == null) continue;
    const measurement = readObservations({
      previous: { mathScore, attendedDays }, current: { mathScore, attendedDays },
    }).current;
    if (!measurements.has(code)) measurements.set(code, new Map());
    const weeks = measurements.get(code);
    if (weeks.has(week)) throw new Error('Duplicate measurement');
    const hasQuiz = [correct, total].some(value => value !== '' && value != null);
    weeks.set(week, { measurement, quiz: hasQuiz ? { correct, total } : null });
  }
  for (const [code, week, days] of values[1]) {
    if (!code || days === '' || days == null) continue;
    if (!isCode(code) || !Number.isInteger(week) || week < 1 || week > 8 ||
      !Number.isInteger(days) || days < 0 || days > 5 || transport.has(key(code, week))) throw new Error('Invalid transport row');
    transport.set(key(code, week), days);
  }
  for (const [code, week] of values[2]) {
    if (!code) continue;
    if (!isCode(code) || !Number.isInteger(week) || week < 2 || week > 8 || logged.has(key(code, week))) throw new Error('Invalid follow-up row');
    logged.add(key(code, week));
  }
  const students = [];
  for (const [code, weeks] of measurements) {
    if (!weeks.has(0) || !weeks.has(1)) continue;
    const previous = weeks.get(0).measurement;
    const current = weeks.get(1).measurement;
    const evidence = readDiagnosisEvidence({
      fractionQuiz: weeks.get(1).quiz,
      lateBusOnAbsenceDays: transport.get(key(code, 1)) ?? null,
    }, current.attendedDays);
    const checkpoints = [];
    for (let week = 2; week <= 8; week++) {
      if (!weeks.has(week)) break;
      checkpoints.push(weeks.get(week).measurement);
    }
    if (weeks.size !== checkpoints.length + 2) throw new Error('Weekly measurements must be consecutive');
    students.push({ code, observations: { previous, current, evidence }, checkpoints });
  }
  return { students, logged };
}

function createSheets(id, credentials, fetcher = fetch) {
  if (!/^[A-Za-z0-9_-]+$/.test(id) || credentials.type !== 'service_account' ||
    !credentials.client_email || !credentials.private_key) throw new Error('Invalid Google Sheets configuration');
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + id;
  let token;
  let expiresAt = 0;
  let tabIds;

  async function getToken() {
    if (Date.now() < expiresAt) return token;
    const now = Math.floor(Date.now() / 1000);
    const encode = object => Buffer.from(JSON.stringify(object)).toString('base64url');
    const assertion = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
      iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: tokenUrl, iat: now, exp: now + 3600,
    });
    const signed = assertion + '.' + sign('RSA-SHA256', Buffer.from(assertion), credentials.private_key).toString('base64url');
    const response = await fetcher(tokenUrl, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(8000),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signed }),
    });
    if (!response.ok) throw new Error('Google authentication failed');
    const result = await response.json();
    if (typeof result.access_token !== 'string' || !Number.isFinite(result.expires_in)) throw new Error('Invalid Google token');
    token = result.access_token;
    expiresAt = Date.now() + Math.max(0, result.expires_in - 60) * 1000;
    return token;
  }

  async function request(path, body) {
    const headers = { Authorization: 'Bearer ' + await getToken() };
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetcher(base + path, {
      method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('Google Sheets request failed');
    return response.json();
  }

  async function load() {
    const result = await request('/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&' +
      ranges.map(range => 'ranges=' + encodeURIComponent(range)).join('&'));
    if (result.valueRanges?.length !== ranges.length) throw new Error('Missing Google Sheets ranges');
    return readRows(result.valueRanges.map(range => range.values ?? []));
  }

  async function save({ measurement, review }) {
    if (!tabIds) {
      const result = await request('?fields=sheets(properties(sheetId,title))');
      tabIds = new Map(result.sheets.map(({ properties }) => [properties.title, properties.sheetId]));
      if (!tabs.every(tab => Number.isInteger(tabIds.get(tab)))) throw new Error('Missing Google Sheets tabs');
    }
    const append = (tab, row) => ({ appendCells: {
      sheetId: tabIds.get(tab), fields: 'userEnteredValue',
      rows: [{ values: row.map(value => ({ userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: value } })) }],
    } });
    const requests = [append('FollowUp', review)];
    if (measurement) requests.unshift(append('Measurements', measurement));
    await request(':batchUpdate', { requests });
  }

  return { load, save };
}

module.exports = { createSheets, readRows };
