function readObservations(input) {
  const { previous, current } = input ?? {};
  const validPeriod = period => (
    period && Number.isInteger(period.mathScore) && period.mathScore >= 0 && period.mathScore <= 100
    && Number.isInteger(period.attendedDays) && period.attendedDays >= 0 && period.attendedDays <= 5
  );

  if (!validPeriod(previous) || !validPeriod(current)) {
    throw new RangeError('Each period requires a whole math score from 0 to 100 and attendance from 0 to 5 days.');
  }

  const period = ({ mathScore, attendedDays }) => ({ mathScore, attendedDays });
  return { previous: period(previous), current: period(current) };
}

function detectRisk(input) {
  const { previous, current } = readObservations(input);
  const mathChange = current.mathScore - previous.mathScore;
  const attendanceChange = current.attendedDays - previous.attendedDays;
  const mathWarning = mathChange <= -15;
  const attendanceWarning = attendanceChange <= -2;
  const risk = mathWarning && attendanceWarning ? 'high' : mathWarning || attendanceWarning ? 'watch' : 'low';

  return { risk, mathChange, attendanceChange };
}

if (typeof module !== 'undefined') {
  module.exports = detectRisk;
  module.exports.readObservations = readObservations;
}
