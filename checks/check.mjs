// Checks index.html before it is published: it runs without typing mistakes,
// the settings make sense, the rule tests pass, and the page draws with these
// settings. Run from the repo root with:  node checks/check.mjs
import { appendFileSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lines = html.split('\n');
const passed = [];
const problems = [];

const problem = (message, line) => problems.push({ message, line });

// Prints the outcome (also to the run's summary page on GitHub) and stops.
function finish() {
  const summary = [];
  if (problems.length) {
    summary.push(`### Not published: ${problems.length} problem${problems.length > 1 ? 's' : ''} in index.html`, '');
    for (const p of problems) {
      const text = ((p.line ? `Line ${p.line}: ` : '') + p.message).replace(/\s*\n\s*/g, ' ');
      summary.push(`- ${text}`);
      console.log(`::error file=index.html${p.line ? `,line=${p.line}` : ''}::${text}`);
    }
    summary.push('', 'The live page has not been changed. Fix the line(s) above and commit again, ' +
      'or use Run workflow to put an earlier version back.');
  } else {
    summary.push('### All checks passed', '', ...passed.map(p => `- ${p}`));
  }
  console.log('\n' + summary.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
  process.exit(problems.length ? 1 : 0);
}

// ------------------------------------------------------- load the two scripts
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => ({
  code: m[1],
  // Lines above the code, so errors are reported with their line in index.html.
  lineOffset: html.slice(0, m.index + '<script>'.length).split('\n').length - 1,
}));
if (blocks.length !== 2) {
  problem(`Expected two <script> sections (the settings, then the page code) but found ${blocks.length}. ` +
    'A <script> or </script> line has probably been changed or removed.');
  finish();
}
const [settings, page] = blocks;

// The first line of the settings section that matches, to point at the right place.
function settingsLine(re) {
  const first = settings.lineOffset, last = first + settings.code.split('\n').length;
  for (let i = first; i < last; i++) if (re.test(lines[i])) return i + 1;
}

// A stand-in for the browser: only the parts of the page that exist in the HTML answer.
const ids = new Set([...html.matchAll(/\bid="([^"${}]+)"/g)].map(m => m[1]));
const elements = new Map();
const element = () => ({
  innerHTML: '', textContent: '', hidden: false, disabled: false,
  addEventListener() {}, querySelector() { return null; }, focus() {},
});
const context = vm.createContext({
  console, URLSearchParams,
  location: { search: '?test' },
  fetch: () => Promise.reject(new Error('the check does not use the network')),
  addEventListener() {},
  document: {
    hidden: false,
    addEventListener() {},
    getElementById(id) {
      if (!ids.has(id)) return null;
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
  },
});
context.window = context;

const errorLine = err => {
  const m = /index\.html:(\d+)/.exec(String(err && err.stack));
  return m ? +m[1] : undefined;
};
const read = code => vm.runInContext(code, context);

function run(block, what) {
  try {
    new vm.Script(block.code, { filename: 'index.html', lineOffset: block.lineOffset }).runInContext(context);
  } catch (err) {
    if (err && err.name === 'SyntaxError') {
      problem(`Typing mistake in the ${what}: ${err.message}. Look at this line and the one just above it ` +
        'for a missing comma, quote or bracket.', errorLine(err));
    } else if (err && err.name === 'ReferenceError') {
      problem(`The ${what} stopped with: ${err.message}. If that is meant to be a word or a time, ` +
        'it needs quotes around it.', errorLine(err));
    } else {
      problem(`The ${what} stopped with: ${err && err.message}.`, errorLine(err));
    }
    finish();
  }
}

// ------------------------------------------------------------------- settings
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_HINT = 'Days are written Sun, Mon, Tue, Wed, Thu, Fri, Sat.';
const TIME_HINT = "a 24-hour time with four digits in quotes, like '17:30' for 5:30pm or '08:00' for 8am";

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isTime = v => typeof v === 'string' && /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(v);
const isClose = v => v === 'sunset' || isTime(v);
const isPlain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const minutes = t => +t.slice(0, 2) * 60 + +t.slice(3);
const show = v => (v === undefined ? 'missing' : typeof v === 'number' ? String(v) : JSON.stringify(v));
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function checkSettings(c) {
  const bad = (message, re) => problem(message, re && settingsLine(re));
  const num = (key, ok, hint) => {
    if (!isNum(c[key]) || !ok(c[key])) bad(`${key} is ${show(c[key])}, but it must be ${hint}.`, new RegExp(`\\b${key}\\s*:`));
  };

  if (!Array.isArray(c.CLUBS) || !c.CLUBS.length) {
    bad('CLUBS must list at least one club.', /\bCLUBS\s*:/);
  } else {
    c.CLUBS.forEach((club, i) => {
      if (!isPlain(club)) {
        return bad(`Club number ${i + 1} must be written like { name: '...', lat: ..., lon: ..., closes: '21:30' }.`, /\bCLUBS\s*:/);
      }
      const named = typeof club.name === 'string' && club.name.trim() !== '';
      const label = named ? `Club "${club.name}"` : `Club number ${i + 1}`;
      const at = named ? new RegExp(`name:\\s*['"\`]${escapeRe(club.name)}['"\`]`) : /\bCLUBS\s*:/;
      if (!named) bad(`${label} needs a name in quotes.`, at);
      if (!isNum(club.lat) || Math.abs(club.lat) > 90) bad(`${label}: lat is ${show(club.lat)}, but it must be a latitude between -90 and 90.`, at);
      if (!isNum(club.lon) || Math.abs(club.lon) > 180) bad(`${label}: lon is ${show(club.lon)}, but it must be a longitude between -180 and 180.`, at);
      if (!isClose(club.closes)) bad(`${label}: closes is ${show(club.closes)}, but it must be ${TIME_HINT}, or 'sunset'.`, at);
      if (club.closesOn === undefined) return;
      if (!isPlain(club.closesOn)) return bad(`${label}: closesOn must look like { Sun: 'sunset' }, or {} for none.`, at);
      for (const [day, close] of Object.entries(club.closesOn)) {
        if (!DAYS.includes(day)) bad(`${label}: closesOn has "${day}", which is not a day. ${DAY_HINT}`, at);
        else if (!isClose(close)) bad(`${label}: closesOn for ${day} is ${show(close)}, but it must be ${TIME_HINT}, or 'sunset'.`, at);
      }
    });
  }

  if (!isPlain(c.AVAILABILITY) || !Object.keys(c.AVAILABILITY).length) {
    bad('AVAILABILITY must list at least one day.', /\bAVAILABILITY\s*:/);
  } else {
    for (const [day, span] of Object.entries(c.AVAILABILITY)) {
      const at = new RegExp(`^\\s*['"]?${escapeRe(day)}['"]?\\s*:`);
      if (!DAYS.includes(day)) bad(`AVAILABILITY has "${day}", which is not a day. ${DAY_HINT}`, at);
      else if (!Array.isArray(span) || span.length !== 2) bad(`AVAILABILITY for ${day} must be a start and an end, like ['17:30', '22:00'].`, at);
      else if (!span.every(isTime)) bad(`AVAILABILITY for ${day}: ${span.filter(t => !isTime(t)).map(show).join(' and ')} must be ${TIME_HINT}.`, at);
      else if (minutes(span[0]) >= minutes(span[1])) bad(`AVAILABILITY for ${day} starts at ${span[0]} and ends at ${span[1]}; the end must be later than the start.`, at);
    }
  }

  for (const key of ['MAX_WIND_KMH', 'MAX_GUST_KMH', 'RAIN_MM']) num(key, v => v > 0, 'a number above 0');
  num('MAX_RAIN_CHANCE', v => v > 0 && v <= 100, 'a percentage above 0 and no more than 100');
  for (const key of ['DRY_LIGHT_BELOW_MM', 'DRY_HEAVY_ABOVE_MM', 'DRY_POINTS_LIGHT', 'DRY_POINTS_MEDIUM', 'DRY_POINTS_HEAVY',
    'DRY_BASE', 'DRY_WIND_AT_KMH', 'DRY_WIND_BONUS', 'DRY_CLEAR_BELOW_PCT', 'DRY_CLEAR_BONUS', 'DRY_HUMID_ABOVE_PCT',
    'DRY_HUMID_PENALTY']) num(key, v => v >= 0, 'a number, 0 or more');
  num('DRY_NIGHT_FACTOR', v => v > 0, 'a number above 0 (0.5 halves drying after sunset)');
  if (isNum(c.DRY_LIGHT_BELOW_MM) && isNum(c.DRY_HEAVY_ABOVE_MM) && c.DRY_LIGHT_BELOW_MM > c.DRY_HEAVY_ABOVE_MM) {
    bad(`DRY_LIGHT_BELOW_MM (${c.DRY_LIGHT_BELOW_MM}) must not be more than DRY_HEAVY_ABOVE_MM (${c.DRY_HEAVY_ABOVE_MM}).`, /\bDRY_LIGHT_BELOW_MM\s*:/);
  }
  if (isNum(c.DRY_BASE) && isNum(c.DRY_HUMID_PENALTY) && c.DRY_BASE <= c.DRY_HUMID_PENALTY) {
    bad(`A humid hour would earn no drying points (DRY_BASE ${c.DRY_BASE} minus DRY_HUMID_PENALTY ${c.DRY_HUMID_PENALTY}), ` +
      'so after rain the court might never count as dry. DRY_BASE must be bigger than DRY_HUMID_PENALTY.', /\bDRY_HUMID_PENALTY\s*:/);
  }

  const whole = (key, lo, hi) => num(key, v => Number.isInteger(v) && v >= lo && v <= hi, `a whole number from ${lo} to ${hi}`);
  whole('FORECAST_DAYS', 1, 16);
  whole('PAST_DAYS', 0, 92);
  whole('TENTATIVE_FROM_DAY', 1, 99);
  num('REFRESH_AFTER_MIN', v => v > 0, 'a number of minutes above 0');
  try {
    if (typeof c.TIMEZONE !== 'string') throw new Error('not text');
    new Intl.DateTimeFormat('en-NZ', { timeZone: c.TIMEZONE });
  } catch {
    bad(`TIMEZONE is ${show(c.TIMEZONE)}, which is not a time zone name. It should be 'Pacific/Auckland'.`, /\bTIMEZONE\s*:/);
  }
}

run(settings, 'settings at the top of the file');
const config = read(`typeof CONFIG === 'undefined' ? undefined : CONFIG`);
if (!isPlain(config)) {
  problem('The settings must start with  const CONFIG = {  and end with  };', settings.lineOffset + 1);
  finish();
}
checkSettings(config);

const stampLines = lines.filter(l => l.trim() === "const VERSION = 'dev';").length;
if (stampLines !== 1) {
  problem(`The line  const VERSION = 'dev';  must appear exactly once and unchanged (found ${stampLines}). ` +
    'The version number is filled in automatically when the page is published.', settingsLine(/\bVERSION\b/));
}
if (problems.length) finish();
passed.push('index.html has no typing mistakes in its settings.');
passed.push(`The settings make sense: ${config.CLUBS.map(c => c.name).join(' and ')}; ` +
  `available on ${DAYS.filter(d => d in config.AVAILABILITY).join(', ')}.`);

// ------------------------------------------------------------------ the rules
run(page, 'page code');
try {
  const results = JSON.parse(read('JSON.stringify(runSelfTest())'));
  if (!Array.isArray(results) || !results.length) throw new Error('the rule tests returned nothing');
  for (const r of results.filter(r => !r.pass)) {
    problem(`Rule test failed - ${r.name}: expected "${r.expected}" but got "${r.got}".`);
  }
  if (problems.length) finish();
  passed.push(`All ${results.length} rule tests pass.`);
} catch (err) {
  problem(`The rule tests could not run: ${err.message}.`, errorLine(err));
  finish();
}

// ----------------------------------------------- draw the page with a forecast
const addDays = (date, n) =>
  new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10) + n)).toISOString().slice(0, 10);

// A made-up forecast in Open-Meteo's shape around today: dry spells, showers, wind.
function fakeForecast(today, offsetSeconds) {
  const dates = Array.from({ length: config.PAST_DAYS + config.FORECAST_DAYS }, (_, i) => addDays(today, i - config.PAST_DAYS));
  const time = dates.flatMap(d => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
  const each = f => time.map((_, k) => f(k));
  const rainy = k => k % 31 < 3;
  return {
    utc_offset_seconds: offsetSeconds,
    hourly: {
      time,
      wind_speed_10m: each(k => 6 + (k * 5) % 27),
      wind_gusts_10m: each(k => 14 + (k * 7) % 33),
      precipitation: each(k => (rainy(k) ? 0.7 : 0)),
      precipitation_probability: each(k => (rainy(k) ? 85 : (k * 3) % 40)),
      relative_humidity_2m: each(k => 55 + (k * 11) % 40),
      cloud_cover: each(k => (k * 13) % 100),
    },
    daily: { time: dates, sunrise: dates.map(d => `${d}T06:30`), sunset: dates.map(d => `${d}T19:30`) },
  };
}

const junk = shown => {
  const m = /\b(undefined|NaN|Infinity)\b|\[object /.exec(shown.replace(/<[^>]*>/g, ' '));
  return m && m[0].trim();
};

try {
  const today = read('nzNow(CONFIG).date');
  // The zone's current offset, so the made-up labels sit on today's real clock.
  const offset = read(`(() => {
    const now = new Date(), c = nzClock(now, CONFIG), [y, m, d] = c.date.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d, 0, c.min) - now.getTime()) / 3600000) * 3600;
  })()`);
  const one = fakeForecast(today, offset);
  context.__forecast = JSON.stringify(config.CLUBS.length === 1 ? one : config.CLUBS.map(() => one));
  read(`state.data = JSON.parse(__forecast); state.error = null;
    state.fetchedDate = nzNow(CONFIG).date; state.fetchedLabel = 'now';
    renderFooter(); render();`);

  const shown = () => read(`document.getElementById('app').innerHTML`);
  const first = shown();
  const cards = (first.match(/<section class="day/g) || []).length;
  if (cards !== config.FORECAST_DAYS) problem(`The page drew ${cards} days instead of ${config.FORECAST_DAYS}.`);
  for (const club of config.CLUBS) {
    const name = club.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    if (!first.includes(`<h3>${name}</h3>`)) problem(`The page did not show the club "${club.name}".`);
  }
  const footer = read(`document.getElementById('foot').innerHTML`);
  for (const [where, text] of [['the list of days', first], ['the note at the bottom', footer]]) {
    if (junk(text)) problem(`The page shows "${junk(text)}" in ${where}; a setting is probably not a proper number or time.`);
  }

  const panels = [...first.matchAll(/data-day="([^"]+)" data-key="([^"]+)"/g)].map(m => [m[1], m[2]]);
  for (const [day, key] of panels) {
    context.__open = JSON.stringify([day, key]);
    read('state.open.clear(); state.open.set(...JSON.parse(__open)); render();');
    const opened = shown();
    if (!opened.includes(`id="detail-${day}">`)) problem(`The hourly detail for ${day} (${key}) did not open.`);
    else if (junk(opened)) problem(`The hourly detail for ${day} shows "${junk(opened)}"; a setting is probably not a proper number or time.`);
    if (problems.length) break;
  }
  if (!problems.length) {
    passed.push(`The page draws ${cards} days for ${config.CLUBS.length} club${config.CLUBS.length > 1 ? 's' : ''}, ` +
      `and all ${panels.length} expandable panels open.`);
  }
} catch (err) {
  problem(`The page could not be drawn with these settings: ${err.message}.`, errorLine(err));
}

finish();
