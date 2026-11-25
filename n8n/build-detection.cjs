const { writeFileSync } = require('node:fs');
const { join } = require('node:path');
const detectRisk = require('../detection.js');
const { diagnoseCase, readDiagnosisEvidence } = require('../diagnosis.js');
const { planIntervention, chooseResources, prioritizeSupport, readCheckpoints, evaluateFollowup, buildRoadmap } = require('../intervention.js');

const code = [
  detectRisk.readObservations.toString(),
  '',
  detectRisk.toString(),
  '',
  readDiagnosisEvidence.toString(),
  readCheckpoints.toString(),
  '',
  'const input = $input.first().json.body;',
  'try {',
  '  const body = detectRisk(input);',
  '  const evidence = readDiagnosisEvidence(input.evidence, input.current.attendedDays);',
  '  const current = readObservations(input).current;',
  '  const checkpoints = readCheckpoints(input, current, readObservations);',
  '  return [{ json: { statusCode: 200, body, evidence, current, checkpoints } }];',
  '} catch (error) {',
  '  if (!(error instanceof RangeError)) throw error;',
  '  return [{ json: { statusCode: 422, body: { error: "INVALID_OBSERVATIONS", message: error.message } } }];',
  '}',
].join('\n');

const diagnosisCode = [
  diagnoseCase.toString(),
  '',
  'const data = $input.first().json;',
  'if (data.statusCode === 200) data.body.diagnosis = diagnoseCase(data.body, data.evidence);',
  'return [{ json: data }];',
].join('\n');

const planCode = [
  planIntervention.toString(),
  prioritizeSupport.toString(),
  'const data = $input.first().json;',
  'if (data.statusCode === 200) {',
  '  data.body.plan = planIntervention(data.body.diagnosis);',
  '  data.body.support = prioritizeSupport(data.body, data.body.diagnosis);',
  '}',
  'return [{ json: data }];',
].join('\n');

const resourcesCode = [
  chooseResources.toString(),
  'const data = $input.first().json;',
  'if (data.statusCode === 200) data.body.resources = chooseResources(data.body.plan);',
  'return [{ json: data }];',
].join('\n');

const evaluationCode = [
  evaluateFollowup.toString(),
  buildRoadmap.toString(),
  'const data = $input.first().json;',
  'if (data.statusCode === 200) {',
  '  const roadmap = buildRoadmap(data.body.plan, data.current, data.checkpoints);',
  '  data.body.roadmap = roadmap.weeks;',
  '  if (roadmap.evaluation) data.body.evaluation = roadmap.evaluation;',
  '}',
  'return [{ json: { statusCode: data.statusCode, body: data.body } }];',
].join('\n');

const stages = [
  ['71a0f0ae-2530-4648-9935-1bfabf88ea5d', 'Detect risk', code],
  ['8c5ded52-d2b3-4705-bdfd-c430f81f477b', 'Diagnose case', diagnosisCode],
  ['345f4f2f-cec1-4936-8fe2-b2ebfca77fea', 'Plan intervention', planCode],
  ['821591bd-4279-42da-b735-4b88cda44928', 'Choose resources', resourcesCode],
  ['93605287-ff57-44ca-8e7c-32768dceb6d4', 'Evaluate follow-up', evaluationCode],
];
const sequence = ['Receive observations', ...stages.map(stage => stage[1]), 'Return detection'];

const workflow = {
  name: 'EduMind AI | Student support',
  active: false,
  nodes: [
    {
      id: '4eca59cb-3004-4312-9bdb-a057d5566287',
      name: 'Receive observations',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 0],
      webhookId: '9afa4de3-cf3e-4abc-851f-282cb9eada60',
      parameters: {
        httpMethod: 'POST',
        path: 'edumind/detection',
        authentication: 'headerAuth',
        responseMode: 'responseNode',
        options: {},
      },
    },
    ...stages.map(([id, name, jsCode], index) => ({
      id,
      name,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [(index + 1) * 250, 0],
      parameters: { jsCode },
    })),
    {
      id: '95403304-6230-4f6a-851e-aafd8ef4e004',
      name: 'Return detection',
      type: 'n8n-nodes-base.respondToWebhook',
      typeVersion: 1.4,
      position: [(stages.length + 1) * 250, 0],
      parameters: {
        respondWith: 'json',
        responseBody: '={{ JSON.stringify($json.body) }}',
        options: { responseCode: '={{ $json.statusCode }}' },
      },
    },
  ],
  connections: Object.fromEntries(sequence.slice(0, -1).map((name, index) => [
    name, { main: [[{ node: sequence[index + 1], type: 'main', index: 0 }]] },
  ])),
  settings: {
    executionOrder: 'v1',
    saveDataSuccessExecution: 'none',
    saveDataErrorExecution: 'none',
    saveManualExecutions: false,
  },
};

writeFileSync(join(__dirname, 'detection.workflow.json'), JSON.stringify(workflow, null, 2) + '\n');
