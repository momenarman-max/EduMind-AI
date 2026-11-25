function readDiagnosisEvidence(input, attendedDays) {
  if (input != null && (typeof input !== 'object' || Array.isArray(input))) {
    throw new RangeError('Evidence must be a JSON object.');
  }

  const { fractionQuiz = null, lateBusOnAbsenceDays = null } = input ?? {};
  let quiz = null;
  if (fractionQuiz !== null) {
    const { correct, total } = fractionQuiz;
    if (!Number.isInteger(total) || total < 1 || total > 100 ||
      !Number.isInteger(correct) || correct < 0 || correct > total) {
      throw new RangeError('Fraction quiz requires a total from 1 to 100 and a correct count from 0 to the total.');
    }
    quiz = { correct, total };
  }

  if (lateBusOnAbsenceDays !== null && (!Number.isInteger(lateBusOnAbsenceDays) ||
    lateBusOnAbsenceDays < 0 || lateBusOnAbsenceDays > 5 - attendedDays)) {
    throw new RangeError('Bus delay days must be within the current absence count.');
  }

  return { fractionQuiz: quiz, lateBusOnAbsenceDays };
}

function diagnoseCase(detection, evidence) {
  if (detection.risk === 'low') return { learning: 'skipped', transport: 'skipped' };

  const quiz = evidence.fractionQuiz;
  let learning = 'unknown';
  if (quiz) learning = quiz.correct * 5 < quiz.total * 3 ? 'fractions' : 'no-signal';

  const bus = evidence.lateBusOnAbsenceDays;
  let transport = 'unknown';
  if (bus !== null) transport = detection.attendanceChange < 0 && bus > 0 ? 'possible-factor' : 'no-signal';

  return { learning, transport };
}

if (typeof module !== 'undefined') module.exports = { diagnoseCase, readDiagnosisEvidence };
