const TZ = 'Asia/Tehran';

function tehranParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

/** Returns { date: "YYYY-MM-DD", time: "HH:mm" } for the current moment in Asia/Tehran. */
function tehranNow() {
  return tehranParts(new Date());
}

/** Returns the "YYYY-MM-DD" Tehran date `daysAgo` days before today. */
function tehranDateDaysAgo(daysAgo) {
  const base = new Date(Date.now() - daysAgo * 86400000);
  return tehranParts(base).date;
}

module.exports = { tehranNow, tehranDateDaysAgo };
