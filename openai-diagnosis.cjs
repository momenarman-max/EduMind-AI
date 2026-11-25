async function suggestDiagnosis(result, options = {}) {
  if (result.risk === 'low') return { status: 'skipped' };
  const {
    apiKey = process.env.OPENAI_API_KEY,
    model = process.env.EDUMIND_OPENAI_MODEL,
    fetcher = fetch,
  } = options;
  if (!apiKey || !model) return { status: 'not-configured' };

  const { learning, transport } = result.diagnosis;
  const allowed = learning === 'fractions' ? ['worked-example', 'explain-steps'] : ['short-skill-check'];
  if (result.attendanceChange < 0) allowed.push('attendance-log');
  if (transport === 'possible-factor') allowed.push('compare-transit-log');
  try {
    const response = await fetcher('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(4500),
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        store: false,
        instructions: 'Choose one evidence-based diagnostic activity for a teacher. Use only the provided signals. Bus overlap is a clue to verify. Do not infer a confirmed cause, change the risk classification, or make a clinical judgment.',
        input: JSON.stringify({
          academicRisk: result.risk,
          learningSignal: learning,
          attendanceDeclined: result.attendanceChange < 0,
          transportSignal: transport,
          allowed,
        }),
        max_output_tokens: 200,
        text: { format: {
          type: 'json_schema', name: 'teacher_diagnostic_activity', strict: true,
          schema: {
            type: 'object', properties: { action: { type: 'string', enum: allowed } },
            required: ['action'], additionalProperties: false,
          },
        } },
      }),
    });
    if (!response.ok) throw new Error('OpenAI request failed');
    const data = await response.json();
    const text = data.output?.filter(item => item.type === 'message')
      .flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text;
    const action = JSON.parse(text).action;
    if (!allowed.includes(action)) throw new Error('Unsupported diagnosis action');
    return { status: 'ready', action };
  } catch {
    return { status: 'unavailable' };
  }
}

module.exports = { suggestDiagnosis };
