const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { readObservations } = require('./detection.js');
const { readDiagnosisEvidence } = require('./diagnosis.js');
const { readCheckpoints } = require('./intervention.js');
const { createSheets } = require('./sheets.cjs');
const { suggestDiagnosis } = require('./openai-diagnosis.cjs');

const loopback = '127.0.0.1';
const key = process.env.EDUMIND_DETECTION_KEY;
const webhook = new URL(process.env.EDUMIND_DETECTION_URL ?? 'http://127.0.0.1:5678/webhook/edumind/detection');
const port = Number(process.env.EDUMIND_PORT ?? '8080');
const origin = 'http://' + loopback + ':' + port;
const allowedHosts = new Set([loopback + ':' + port, 'localhost:' + port]);
const roadmapFocuses = ['fractions', 'word-problems', 'mixed-review', 'independent', 'review', 'monitor'];
const supportActions = ['teacher-check-in', 'fraction-practice', 'math-check', 'attendance-check', 'transport-check', 'weekly-review'];
const sheetsId = process.env.EDUMIND_GOOGLE_SPREADSHEET_ID;
const sheetsFile = process.env.EDUMIND_GOOGLE_CREDENTIALS_FILE;
const sheetsConfigured = Boolean(sheetsId && sheetsFile);
let sheets;
let sharedWrites = Promise.resolve();
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/n8n-flow.html', ['n8n-flow.html', 'text/html; charset=utf-8']],
  ['/editorial.css', ['editorial.css', 'text/css; charset=utf-8']],
  ['/academic-measure.webp', ['academic-measure.webp', 'image/webp']],
  ['/academic-support.webp', ['academic-support.webp', 'image/webp']],
  ['/academic-followup.webp', ['academic-followup.webp', 'image/webp']],
  ['/n8n/detection.workflow.json', ['n8n/detection.workflow.json', 'application/json; charset=utf-8']],
  ['/detection.js', ['detection.js', 'text/javascript; charset=utf-8']],
  ['/diagnosis.js', ['diagnosis.js', 'text/javascript; charset=utf-8']],
  ['/intervention.js', ['intervention.js', 'text/javascript; charset=utf-8']],
]);

if (!key) throw new Error('Set EDUMIND_DETECTION_KEY to the n8n Header Auth value.');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid EDUMIND_PORT.');
if (webhook.username || webhook.password || !(webhook.protocol === 'https:' ||
  (webhook.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(webhook.hostname)))) {
  throw new Error('Use an HTTPS webhook or a loopback HTTP webhook.');
}

class RequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestError(415, 'JSON_REQUIRED');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 4096) {
      request.resume();
      throw new RequestError(413, 'BODY_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RequestError(400, 'INVALID_JSON');
  }
}

function normalizeObservations(input) {
  let observations;
  try {
    observations = readObservations(input);
    observations.evidence = readDiagnosisEvidence(input.evidence, observations.current.attendedDays);
    observations.checkpoints = readCheckpoints(input, observations.current, readObservations);
  } catch {
    throw new RequestError(422, 'INVALID_OBSERVATIONS');
  }
  return observations;
}

async function runDetection(observations) {
  try {
    const upstream = await fetch(webhook, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Edumind-Key': key,
      },
      body: JSON.stringify(observations),
      signal: AbortSignal.timeout(8000),
    });
    if (!upstream.ok) throw new Error('Unexpected status');
    const body = await upstream.json();
    const { risk, mathChange, attendanceChange, plan, resources, evaluation, roadmap, support } = body;
    const { learning, transport } = body.diagnosis ?? {};
    if (!['high', 'watch', 'low'].includes(risk) ||
      !Number.isInteger(mathChange) || Math.abs(mathChange) > 100 ||
      !Number.isInteger(attendanceChange) || Math.abs(attendanceChange) > 5 ||
      !['fractions', 'no-signal', 'unknown', 'skipped'].includes(learning) ||
      !['possible-factor', 'no-signal', 'unknown', 'skipped'].includes(transport) ||
      !['fractions', 'review', 'monitor'].includes(plan?.focus) ||
      !Number.isInteger(plan.sessions) || plan.sessions < 0 || plan.sessions > 7 ||
      !Number.isInteger(plan.minutes) || plan.minutes < 0 || plan.minutes > 90 ||
      !Array.isArray(resources) || resources.length > 2 ||
      !resources.every(id => ['fraction-video', 'fraction-practice', 'review-checklist'].includes(id)) ||
      !Array.isArray(support) || support.length > 5 || !support.every(id => supportActions.includes(id)) ||
      !Array.isArray(roadmap) || roadmap.length !== 8) {
      throw new Error('Invalid detection result');
    }
    const result = {
      risk, mathChange, attendanceChange, diagnosis: { learning, transport },
      plan: { focus: plan.focus, sessions: plan.sessions, minutes: plan.minutes },
      resources,
      support,
      roadmap: roadmap.map((row, index) => {
        const { week, focus, sessions, minutes, mathTarget, attendanceTarget } = row;
        if (week !== index + 1 || !roadmapFocuses.includes(focus) ||
          !Number.isInteger(sessions) || sessions < 0 || sessions > 7 ||
          !Number.isInteger(minutes) || minutes < 0 || minutes > 90 ||
          !Number.isInteger(mathTarget) || mathTarget < 0 || mathTarget > 100 ||
          !Number.isInteger(attendanceTarget) || attendanceTarget < 0 || attendanceTarget > 5) {
          throw new Error('Invalid roadmap');
        }
        const measurement = index === 0 ? observations.current : observations.checkpoints[index - 1] ?? null;
        return { week, focus, sessions, minutes, mathTarget, attendanceTarget, measurement };
      }),
    };
    if (observations.checkpoints.length) {
      const { mathScore, attendedDays } = observations.checkpoints.at(-1);
      if (!roadmapFocuses.includes(evaluation?.focus) ||
        evaluation.mathScore !== mathScore || evaluation.attendedDays !== attendedDays ||
        evaluation.mathChange !== mathScore - observations.current.mathScore ||
        evaluation.attendanceChange !== attendedDays - observations.current.attendedDays) {
        throw new Error('Invalid follow-up result');
      }
      result.evaluation = {
        mathScore, attendedDays, mathChange: evaluation.mathChange, attendanceChange: evaluation.attendanceChange,
        focus: evaluation.focus,
      };
    }
    return result;
  } catch (error) {
    if (error.name === 'TimeoutError') throw new RequestError(504, 'DETECTION_TIMEOUT');
    throw new RequestError(502, 'DETECTION_UNAVAILABLE');
  }
}

async function getSheets() {
  if (!sheetsConfigured) throw new RequestError(503, 'SHEETS_NOT_CONFIGURED');
  try {
    sheets ??= createSheets(sheetsId, JSON.parse(await readFile(sheetsFile, 'utf8')));
    return sheets;
  } catch {
    throw new RequestError(502, 'SHEETS_UNAVAILABLE');
  }
}

async function loadShared() {
  const client = await getSheets();
  try {
    return await client.load();
  } catch {
    throw new RequestError(502, 'SHEETS_UNAVAILABLE');
  }
}

async function saveSharedCheckpoint(input) {
  const { code, week, measurement } = input ?? {};
  if (typeof code !== 'string' || !/^[A-Z0-9_-]{3,24}$/.test(code) ||
    !Number.isInteger(week) || week < 2 || week > 8) {
    throw new RequestError(422, 'INVALID_CHECKPOINT');
  }
  const { students, logged } = await loadShared();
  const student = students.find(record => record.code === code);
  if (!student) throw new RequestError(404, 'STUDENT_NOT_FOUND');
  const requested = normalizeObservations({ ...student.observations, checkpoints: [measurement] }).checkpoints[0];
  const expected = student.checkpoints.length + 2;
  const last = student.checkpoints.at(-1);
  const repeated = week === expected - 1 && last?.mathScore === requested.mathScore && last?.attendedDays === requested.attendedDays;
  if (!repeated && week !== expected) throw new RequestError(409, 'SHARED_MEASUREMENT_CONFLICT');
  const checkpoints = repeated ? student.checkpoints : [...student.checkpoints, requested];
  const analysis = await runDetection({ ...student.observations, checkpoints });
  if (!logged.has(code + ':' + week)) {
    const next = analysis.roadmap[week];
    const review = [
      code, week, analysis.risk, analysis.evaluation.mathChange, analysis.evaluation.attendanceChange,
      analysis.evaluation.focus, next?.sessions ?? 0, next?.minutes ?? 0, new Date().toISOString(),
    ];
    try {
      await (await getSheets()).save({
        measurement: repeated ? null : [code, week, requested.mathScore, requested.attendedDays],
        review,
      });
    } catch {
      throw new RequestError(502, 'SHEETS_UNAVAILABLE');
    }
  } else if (!repeated) {
    throw new RequestError(409, 'SHARED_MEASUREMENT_CONFLICT');
  }
  return { student: { ...student, checkpoints }, analysis };
}

createServer({ requestTimeout: 10000, headersTimeout: 8000 }, async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (!allowedHosts.has(request.headers.host)) {
    return json(response, 403, { error: 'FORBIDDEN_HOST' });
  }

  try {
    const path = new URL(request.url, origin).pathname;
    if (request.method === 'GET' && path === '/api/shared-students') {
      const students = sheetsConfigured ? (await loadShared()).students : [];
      return json(response, 200, { configured: sheetsConfigured, students });
    }
    if (request.method === 'POST' && ['/api/detection', '/api/shared-checkpoint'].includes(path)) {
      const source = request.headers.origin;
      if (source && source !== 'http://' + request.headers.host) {
        throw new RequestError(403, 'FORBIDDEN_ORIGIN');
      }
      const input = await readJson(request);
      if (path === '/api/shared-checkpoint') {
        const job = sharedWrites.then(() => saveSharedCheckpoint(input));
        sharedWrites = job.catch(() => {});
        return json(response, 200, await job);
      }
      const observations = normalizeObservations(input);
      const result = await runDetection(observations);
      if (!observations.checkpoints.length) result.aiAdvice = await suggestDiagnosis(result);
      return json(response, 200, result);
    }
    if (request.method === 'GET' && files.has(path)) {
      const [name, type] = files.get(path);
      const body = await readFile(join(__dirname, name));
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
      return;
    }
    throw new RequestError(404, 'NOT_FOUND');
  } catch (error) {
    json(response, error instanceof RequestError ? error.status : 500, {
      error: error instanceof RequestError ? error.message : 'SERVER_ERROR',
    });
  }
}).listen(port, loopback, () => console.log('EduMind AI running at ' + origin));
