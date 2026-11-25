function planIntervention(diagnosis, generalSubject = false) {
  if (diagnosis.learning === 'skipped') return { focus: 'monitor', sessions: 0, minutes: 0 };
  if (generalSubject) return { focus: 'guided', sessions: 2, minutes: 15 };
  if (diagnosis.learning === 'fractions') return { focus: 'fractions', sessions: 3, minutes: 20 };
  return { focus: 'review', sessions: 1, minutes: 15 };
}

function chooseResources(plan) {
  return plan.focus === 'fractions' ? ['fraction-video', 'fraction-practice']
    : plan.focus === 'review' ? ['review-checklist'] : [];
}

function prioritizeSupport(detection, diagnosis) {
  if (detection.risk !== 'high') return [];
  const priorities = ['teacher-check-in'];
  priorities.push(diagnosis.learning === 'fractions' ? 'fraction-practice' : 'math-check');
  if (detection.attendanceChange < 0) priorities.push('attendance-check');
  if (diagnosis.transport === 'possible-factor') priorities.push('transport-check');
  priorities.push('weekly-review');
  return priorities;
}

function readCheckpoints(input, current, normalize) {
  const checkpoints = input.checkpoints ?? (input.weekTwo == null ? [] : [input.weekTwo]);
  if (!Array.isArray(checkpoints) || checkpoints.length > 7) {
    throw new RangeError('Provide at most seven weekly measurements, in order from week two.');
  }
  return checkpoints.map(week => normalize({ previous: current, current: week }).current);
}

function evaluateFollowup(focus, baseline, previous, measurement) {
  const { mathScore, attendedDays } = measurement;
  let next = focus;
  if (attendedDays >= 4) {
    if (focus === 'fractions' && mathScore >= 70 && mathScore - baseline.mathScore >= 10) next = 'word-problems';
    if (focus === 'word-problems') {
      if (mathScore < 70) next = 'fractions';
      else if (mathScore >= 78 && previous.mathScore >= 75) next = 'mixed-review';
    }
    if (focus === 'mixed-review') {
      if (mathScore < 75) next = 'word-problems';
      else if (mathScore >= 85) next = 'independent';
    }
    if (focus === 'independent' && mathScore < 80) next = 'mixed-review';
  }
  return {
    ...measurement,
    mathChange: mathScore - baseline.mathScore,
    attendanceChange: attendedDays - baseline.attendedDays,
    focus: next,
  };
}

function buildRoadmap(plan, baseline, checkpoints, generalSubject = false) {
  const projected = ['fractions', 'fractions', 'word-problems', 'word-problems', 'word-problems',
    'mixed-review', 'mixed-review', 'independent'];
  const generalFocus = ['guided', 'guided', 'guided', 'apply', 'apply', 'apply', 'consolidate', 'consolidate'];
  const mathTargets = [60, 68, 72, 74, 76, 78, 82, 85];
  const weeks = [];
  let focus = plan.focus;
  let previous = baseline;
  let evaluation = null;
  for (let index = 0; index < 8; index++) {
    const measurement = index === 0 ? baseline : checkpoints[index - 1] ?? null;
    let scheduledFocus = focus;
    if (generalSubject && plan.focus === 'guided') scheduledFocus = generalFocus[index];
    else if (index > checkpoints.length + 1 && plan.focus === 'fractions') scheduledFocus = projected[index];
    const shorter = scheduledFocus === 'mixed-review' || scheduledFocus === 'independent';
    const sessions = shorter ? (scheduledFocus === 'mixed-review' ? 2 : 1) : plan.sessions;
    const minutes = scheduledFocus === 'independent' ? 15 : plan.minutes;
    weeks.push({
      week: index + 1,
      focus: scheduledFocus,
      sessions,
      minutes,
      mathTarget: generalSubject ? Math.min(100, baseline.mathScore + (plan.sessions ? 2 * index : 0))
        : Math.max(baseline.mathScore, mathTargets[index]),
      attendanceTarget: index < 4 ? 4 : 5,
      measurement,
    });
    if (index > 0 && measurement) {
      evaluation = evaluateFollowup(focus, baseline, previous, measurement);
      if (generalSubject && plan.focus === 'guided') evaluation.focus = generalFocus[Math.min(index + 1, 7)];
      focus = evaluation.focus;
      previous = measurement;
    }
  }
  return { weeks, evaluation };
}

if (typeof module !== 'undefined') module.exports = { planIntervention, chooseResources, prioritizeSupport, readCheckpoints, evaluateFollowup, buildRoadmap };
