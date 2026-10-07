// Checks index.html before it is published: it runs without typing mistakes,
// the settings make sense, the rule tests pass, and the page loads and draws
// with these settings. Run from the repo root with:  node checks/check.mjs
import { appendFileSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lines = html.split('\n');
const restoring = process.env.RESTORING || '';   // set when an earlier version is being put back
const passed = [];
const problems = [];

const problem = (message, line) => problems.push({ message, line });

let stopped;   // an error the page threw while loading in the background
process.on('unhandledRejection', err => { stopped = err; });

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
    summary.push('', restoring
      ? `Version ${restoring} was not put back, because it does not pass its checks. The live page has not been changed. ` +
        `Try another version, or ask Claude to bring ${restoring} back.`
      : 'The live page has not been changed. Fix the line(s) above and commit again, ' +
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

// A stand-in for the browser: only the parts of the page that exist in the HTML
// answer, and the page gets a clock the check can set, so the result does not
// depend on the time of day the check happens to run.
const ids = new Set([...html.matchAll(/\bid="([^"${}]+)"/g)].map(m => m[1]));
function browser(search, fetch) {
  const elements = new Map();
  const element = () => ({
    innerHTML: '', textContent: '', hidden: false, disabled: false,
    addEventListener(type, handler) { this['on' + type] = handler; },
    querySelector() { return null; }, focus() {},
  });
  const context = vm.createContext({
    console, URLSearchParams, fetch,
    location: { search },
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
  vm.runInContext(`{ const Real = Date; let pinned = null;
    globalThis.__setClock = ms => { pinned = ms; };
    globalThis.Date = class extends Real {
      constructor(...a) { if (a.length || pinned === null) super(...a); else super(pinned); }
      static now() { return pinned === null ? Real.now() : pinned; }
    }; }`, context);
  return { context, element: id => elements.get(id), read: code => vm.runInContext(code, context) };
}

const errorLine = err => {
  const m = /index\.html:(\d+)/.exec(String(err && err.stack));
  return m ? +m[1] : undefined;
};
const start = (block, target) =>
  new vm.Script(block.code, { filename: 'index.html', lineOffset: block.lineOffset }).runInContext(target.context);

const test = browser('?test', () => Promise.reject(new Error('this part of the check does not use the network')));
const read = test.read;

function run(block, what) {
  try {
    start(block, test);
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
    // Array.from, so a gap left by a stray comma is looked at rather than skipped.
    Array.from(c.CLUBS).forEach((club, i) => {
      if (club === undefined) return bad(`CLUBS has an extra comma, so club number ${i + 1} is empty. Remove the extra comma.`, /\bCLUBS\s*:/);
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
      else if (!Array.isArray(span) || span.length !== 2 || span.includes(undefined)) bad(`AVAILABILITY for ${day} must be a start and an end, like ['17:30', '22:00'].`, at);
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
    const zone = new Intl.DateTimeFormat('en-NZ', { timeZone: c.TIMEZONE }).resolvedOptions().timeZone;
    // The browser ignores capital letters here, but Open-Meteo answers "Invalid timezone" for them.
    if (zone !== c.TIMEZONE && zone.toLowerCase() === c.TIMEZONE.toLowerCase()) throw new Error('wrong capitals');
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
try {
  checkSettings(config);
} catch (err) {
  problem(`The settings could not be checked (${err.message}). Something in them is not written the usual way.`);
}

// JavaScript quietly keeps only the last of two lines with the same name, so look at the text.
const firstAt = new Map();
settings.code.split('\n').forEach((text, i) => {
  const m = /^\s*['"]?(Sun|Mon|Tue|Wed|Thu|Fri|Sat)['"]?\s*:\s*\[/.exec(text) || /^\s*([A-Z][A-Z0-9_]+)\s*:/.exec(text);
  if (!m) return;
  const line = settings.lineOffset + i + 1;
  if (!firstAt.has(m[1])) return firstAt.set(m[1], line);
  problem(`${m[1]} is written twice (lines ${firstAt.get(m[1])} and ${line}). Only the last one would be used, so keep one line for it.` +
    (DAYS.includes(m[1]) ? ' A day can have only one start and one end.' : ''), line);
});

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
function fakeForecast(today, offsetSeconds, pastDays, forecastDays) {
  const dates = Array.from({ length: pastDays + forecastDays }, (_, i) => addDays(today, i - pastDays));
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
const dayCards = shown => (shown.match(/<section class="day/g) || []).length;

let today, offset, midday;
try {
  today = read('nzNow(CONFIG).date');
  // The zone's current offset, so the made-up labels sit on today's real clock.
  offset = read(`(() => {
    const now = new Date(), c = nzClock(now, CONFIG), [y, m, d] = c.date.split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d, 0, c.min) - now.getTime()) / 3600000) * 3600;
  })()`);
  const one = fakeForecast(today, offset, config.PAST_DAYS, config.FORECAST_DAYS);
  test.context.__forecast = JSON.stringify(config.CLUBS.length === 1 ? one : config.CLUBS.map(() => one));
  const shown = () => read(`document.getElementById('app').innerHTML`);
  const [y, m, d] = today.split('-').map(Number);
  const clockAt = min => Date.UTC(y, m - 1, d, 0, min) - offset * 1000;
  midday = clockAt(12 * 60 + 20);
  let cards = 0, opened = 0;

  // Today at 3am, 12:20pm, 6:40pm, 9:45pm and 10:15pm: before play, while playing
  // and after closing. All well inside the day, so a daylight-saving change (which
  // puts "offset" an hour out for part of that day) cannot push one into tomorrow.
  for (const min of [3 * 60, 12 * 60 + 20, 18 * 60 + 40, 21 * 60 + 45, 22 * 60 + 15]) {
    read(`__setClock(${clockAt(min)})`);
    read(`state.open.clear(); state.data = JSON.parse(__forecast); state.error = null;
      state.fetchedDate = nzNow(CONFIG).date; state.fetchedLabel = 'now';
      renderFooter(); render();`);

    const first = shown();
    cards = dayCards(first);
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
      if (problems.length) break;
      test.context.__open = JSON.stringify([day, key]);
      read('state.open.clear(); state.open.set(...JSON.parse(__open)); render();');
      const detail = shown();
      if (!detail.includes(`id="detail-${day}">`)) problem(`The hourly detail for ${day} (${key}) did not open.`);
      else if (junk(detail)) problem(`The hourly detail for ${day} shows "${junk(detail)}"; a setting is probably not a proper number or time.`);
    }
    if (problems.length) break;
    opened += panels.length;
  }
  if (!problems.length) {
    passed.push(`The page draws ${cards} days for ${config.CLUBS.length} club${config.CLUBS.length > 1 ? 's' : ''} ` +
      `at five times of day, and all ${opened} expandable panels open.`);
  }
} catch (err) {
  problem(`The page could not be drawn with these settings: ${err.message}.`, errorLine(err));
}
if (problems.length) finish();

// ------------------------------------------- open the page the normal way too
// Everything above ran with ?test, which skips the page's own start-up and
// loading code. Start it once more the way a phone does, with a stand-in for
// Open-Meteo that sends back only what the page asked for.
const openMeteo = async url => {
  const asked = new URL(url).searchParams;
  const places = (asked.get('latitude') || '').split(',').filter(Boolean).length;
  if (!places) return { ok: false, status: 400, json: async () => ({ error: true, reason: 'No latitude was asked for' }) };
  const answer = () => {
    const loc = fakeForecast(today, offset, +asked.get('past_days') || 0, +asked.get('forecast_days') || 7);
    for (const part of ['hourly', 'daily']) {
      const names = (asked.get(part) || '').split(',');
      for (const k of Object.keys(loc[part])) if (k !== 'time' && !names.includes(k)) delete loc[part][k];
    }
    return loc;
  };
  const data = places === 1 ? answer() : Array.from({ length: places }, answer);
  return { ok: true, status: 200, json: async () => data };
};

try {
  const phone = browser('', openMeteo);
  phone.read(`__setClock(${midday})`);
  for (const block of blocks) start(block, phone);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 50 && !stopped && phone.read('state.loading'); i++) await tick();
  await tick();   // lets an error in the final drawing surface
  if (stopped) throw stopped;
  const error = phone.read('state.error');
  if (error) throw new Error(error);
  const app = phone.element('app');
  const drawn = dayCards(app ? app.innerHTML : '');
  if (drawn !== config.FORECAST_DAYS) throw new Error(`it drew ${drawn} days instead of ${config.FORECAST_DAYS}`);

  const tap = /data-day="([^"]+)" data-key="([^"]+)"/.exec(app.innerHTML);
  if (tap) {
    if (typeof app.onclick !== 'function') throw new Error('taps on the page are not being listened for');
    app.onclick({ target: { closest: () => ({ dataset: { day: tap[1], key: tap[2] } }) } });
    if (!app.innerHTML.includes(`id="detail-${tap[1]}">`)) throw new Error('tapping a window did not open its hourly detail');
  }
  passed.push('Opened the normal way, the page loads the forecast, draws it, and a tap opens the hourly detail.');
} catch (err) {
  problem(`Opened the normal way (without ?test), the page did not load and draw the forecast: ${err && err.message}.`, errorLine(err));
}

finish();
