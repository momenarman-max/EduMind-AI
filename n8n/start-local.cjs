const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { existsSync, mkdtempSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const workflow = require('./detection.workflow.json');

const n8nBin = resolve(process.env.EDUMIND_N8N_BIN ??
  join(tmpdir(), 'edumind-n8n-runtime', 'node_modules', 'n8n', 'bin', 'n8n'));
const key = randomBytes(32).toString('hex');
const workflowId = 'EduMindDetection';
const credential = { id: 'EduMindHeaderKey', name: 'EduMind local bridge' };
const n8nPort = process.env.EDUMIND_N8N_PORT ?? '5678';
const appPort = process.env.EDUMIND_PORT ?? '8080';
const n8nOrigin = 'http://127.0.0.1:' + n8nPort;
const appOrigin = 'http://127.0.0.1:' + appPort;
const children = [];

let n8nEnv;
function runCli(...args) {
  const result = spawnSync(process.execPath, [n8nBin, ...args], { env: n8nEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('n8n command failed: ' + args[0]);
}

function launch(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  return new Promise((_, reject) => {
    child.once('error', reject);
    child.once('exit', code => reject(new Error(args[0] + ' exited (' + code + ').')));
  });
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      // The process may still be starting.
    }
    await delay(500);
  }
  throw new Error('No successful startup response from ' + url);
}

function stop() {
  children.forEach(child => { if (child.exitCode === null) child.kill(); });
}

async function main() {
  if (!existsSync(n8nBin)) throw new Error('Install n8n or set EDUMIND_N8N_BIN to its bin/n8n file.');
  if (![n8nPort, appPort].every(value => /^\d+$/.test(value) && +value >= 1024 && +value <= 65535) ||
    n8nPort === appPort) throw new Error('Choose two distinct local ports.');

  const localFolder = mkdtempSync(join(tmpdir(), 'edumind-n8n-data-'));
  n8nEnv = {
    ...process.env,
    N8N_USER_FOLDER: localFolder,
    N8N_HOST: '127.0.0.1',
    N8N_LISTEN_ADDRESS: '127.0.0.1',
    N8N_PORT: n8nPort,
    N8N_PROTOCOL: 'http',
    WEBHOOK_URL: n8nOrigin + '/',
    N8N_RUNNERS_MODE: 'internal',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
    N8N_TEMPLATES_ENABLED: 'false',
  };
  const credentialsFile = join(localFolder, 'credentials-import.json');
  const workflowFile = join(localFolder, 'workflow-import.json');
  writeFileSync(credentialsFile, JSON.stringify([{
    ...credential,
    type: 'httpHeaderAuth',
    data: { name: 'X-Edumind-Key', value: key },
  }]), { flag: 'wx', mode: 0o600 });
  try {
    runCli('import:credentials', '--input=' + credentialsFile);
  } finally {
    unlinkSync(credentialsFile);
  }

  const webhookNode = workflow.nodes.find(node => node.type === 'n8n-nodes-base.webhook');
  webhookNode.credentials = { httpHeaderAuth: credential };
  workflow.id = workflowId;
  writeFileSync(workflowFile, JSON.stringify(workflow), { flag: 'wx' });
  runCli('import:workflow', '--input=' + workflowFile);
  runCli('publish:workflow', '--id=' + workflowId);

  const n8nExit = launch([n8nBin, 'start'], n8nEnv);
  await Promise.race([waitForHealth(n8nOrigin + '/healthz/readiness'), n8nExit]);
  const appExit = launch([join(__dirname, '..', 'server.cjs')], {
    ...process.env,
    EDUMIND_PORT: appPort,
    EDUMIND_DETECTION_URL: n8nOrigin + '/webhook/edumind/detection',
    EDUMIND_DETECTION_KEY: key,
  });
  await Promise.race([waitForHealth(appOrigin + '/'), n8nExit, appExit]);
  const sample = {
    previous: { mathScore: 82, attendedDays: 5 },
    current: { mathScore: 54, attendedDays: 3 },
    evidence: { fractionQuiz: { correct: 2, total: 6 }, lateBusOnAbsenceDays: 2 },
    weekTwo: { mathScore: 70, attendedDays: 5 },
  };
  const check = await fetch(appOrigin + '/api/detection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sample),
    signal: AbortSignal.timeout(10000),
  });
  if (!check.ok) throw new Error('Detection smoke check failed (HTTP ' + check.status + ').');
  const result = await check.json();
  if (result.risk !== 'high' || result.mathChange !== -28 || result.attendanceChange !== -2 ||
    result.diagnosis?.learning !== 'fractions' || result.diagnosis?.transport !== 'possible-factor' ||
    result.plan?.sessions !== 3 || result.resources?.length !== 2 || result.roadmap?.length !== 8 ||
    result.evaluation?.mathChange !== 16 || result.evaluation?.focus !== 'word-problems') {
    throw new Error('Analysis smoke check returned unexpected values.');
  }
  console.log('Open EduMind at ' + appOrigin);
  await Promise.race([n8nExit, appExit]);
}

process.once('SIGINT', () => { stop(); process.exit(130); });
process.once('SIGTERM', () => { stop(); process.exit(143); });
main().catch(error => {
  stop();
  console.error(error.message);
  process.exitCode = 1;
});
