#!/usr/bin/env node
'use strict';
// flutter-l10n-audit: find untranslated, broken and hardcoded strings in a Flutter app.
// Zero dependencies, Node 18+. Reads l10n.yaml + ARB files + lib/**/*.dart. Never writes.
//
// Usage: l10n-audit [project-dir] [--json] [--fail-on error|warning|info] [--no-hardcoded] [--no-unused]

const fs = require('fs');
const path = require('path');

const SEVERITY = { error: 3, warning: 2, info: 1 };

const RULES = {
  L01: { severity: 'error', title: 'Missing translation' },
  L02: { severity: 'error', title: 'Placeholder mismatch' },
  L03: { severity: 'error', title: 'Broken ICU message (unbalanced braces)' },
  L04: { severity: 'error', title: 'Duplicate key in ARB file' },
  L05: { severity: 'warning', title: 'Empty translation' },
  L06: { severity: 'info', title: 'Placeholder not declared in @metadata' },
  L07: { severity: 'warning', title: 'Hardcoded user-facing string in Dart' },
  L08: { severity: 'info', title: 'Key only in this locale (not in template)' },
  L09: { severity: 'info', title: 'Possibly untranslated (same text as template)' },
  L10: { severity: 'info', title: 'Key never used in lib/' },
};

// ── ARB / ICU helpers ─────────────────────────────────────────────────────────

/** Top-level keys of a JSON object text, in order, including duplicates (JSON.parse drops them). */
function topLevelKeys(text) {
  const keys = [];
  let depth = 0, i = 0, expectKey = false;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') { s += text[j] + text[j + 1]; j += 2; continue; } s += text[j++]; }
      if (depth === 1 && expectKey) {
        const line = text.slice(0, i).split('\n').length;
        keys.push({ key: JSON.parse('"' + s + '"'), line });
        expectKey = false;
      }
      i = j + 1;
      continue;
    }
    if (c === '{' || c === '[') { depth++; if (depth === 1 && c === '{') expectKey = true; }
    else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 1) expectKey = true;
    i++;
  }
  return keys;
}

/** Placeholder names an ICU message uses: {name}, {count, plural, ...}. Text inside plural branches is scanned too. */
function placeholders(msg, escaping = false) {
  const names = new Set();
  // With use-escaping: true in l10n.yaml, '{...}' is literal text. Flutter's default is false.
  const s = escaping ? String(msg).replace(/'[^']*'/g, '') : String(msg);
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const ident = () => { const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i)); if (!m) return null; i += m[0].length; return m[0]; };
  const skipBlock = () => { let d = 0; while (i < s.length) { if (s[i] === '{') d++; else if (s[i] === '}') { d--; if (d === 0) { i++; return; } } i++; } };
  // text := (char | argument)* until '}' (end of a branch) or end
  function text() {
    while (i < s.length && s[i] !== '}') {
      if (s[i] === '{') argument(); else i++;
    }
  }
  function argument() {
    const start = i;
    i++; ws();
    const name = ident();
    ws();
    if (!name) { i = start; skipBlock(); return; }
    names.add(name);
    if (s[i] === '}') { i++; return; }
    if (s[i] !== ',') { i = start; skipBlock(); return; }
    i++; ws();
    const type = ident();
    ws();
    if (type === 'plural' || type === 'select' || type === 'selectordinal') {
      if (s[i] === ',') i++;
      // options: selector '{' text '}' ...
      while (i < s.length) {
        ws();
        if (s[i] === '}') { i++; return; }
        const m = /^(=\d+|offset:\s*\d+|[A-Za-z_][\w-]*)/.exec(s.slice(i));
        if (!m) { skipBlock(); return; }
        i += m[0].length; ws();
        if (m[0].startsWith('offset')) continue;
        if (s[i] !== '{') return;
        i++; text();
        if (s[i] === '}') i++;
      }
    } else {
      // {x, number, ...} etc: skip the rest of this argument
      let d = 1;
      while (i < s.length && d > 0) { if (s[i] === '{') d++; else if (s[i] === '}') d--; i++; }
    }
  }
  while (i < s.length) { text(); if (s[i] === '}') i++; }
  return names;
}

function bracesBalanced(msg, escaping = false) {
  const s = escaping ? String(msg).replace(/'[^']*'/g, '') : String(msg);
  let d = 0;
  for (const c of s) { if (c === '{') d++; else if (c === '}') { d--; if (d < 0) return false; } }
  return d === 0;
}

// ── project discovery ─────────────────────────────────────────────────────────

function readYamlFlat(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Za-z_-]+)\s*:\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'build' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

function localeOf(file, prefix) {
  const base = path.basename(file, '.arb');
  if (prefix && base.startsWith(prefix)) return base.slice(prefix.length);
  const m = base.match(/(?:^|_)([a-z]{2,3}(?:_[A-Z][a-zA-Z]{1,3})?)$/);
  return m ? m[1] : base;
}

function findArbSetup(root) {
  const cfg = readYamlFlat(path.join(root, 'l10n.yaml'));
  let arbDir = cfg['arb-dir'] ? path.join(root, cfg['arb-dir']) : null;
  if (!arbDir || !fs.existsSync(arbDir)) {
    const candidates = ['lib/l10n', 'lib/src/l10n', 'l10n', 'assets/l10n', 'lib/i18n', 'assets/translations'].map((d) => path.join(root, d));
    arbDir = candidates.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.arb')));
  }
  if (!arbDir) {
    const any = walk(root, (p) => p.endsWith('.arb'))[0];
    if (any) arbDir = path.dirname(any);
  }
  if (!arbDir) return null;
  const files = fs.readdirSync(arbDir).filter((f) => f.endsWith('.arb')).map((f) => path.join(arbDir, f));
  const templateName = cfg['template-arb-file'];
  let template = templateName ? files.find((f) => path.basename(f) === templateName) : null;
  if (!template) template = files.find((f) => /_en\.arb$/.test(f)) || files[0];
  const tBase = path.basename(template, '.arb');
  const pm = tBase.match(/^(.*?_)[a-z]{2,3}(_[A-Z]\w*)?$/);
  const prefix = pm ? pm[1] : '';
  return { root, arbDir, files, template, prefix, cfg };
}

// ── checks ────────────────────────────────────────────────────────────────────

function loadArb(file) {
  const text = fs.readFileSync(file, 'utf8');
  let data;
  try { data = JSON.parse(text); } catch (e) { return { file, text, data: null, parseError: e.message, keys: [] }; }
  return { file, text, data, keys: topLevelKeys(text) };
}

const isMessageKey = (k) => !k.startsWith('@');

function auditArb(setup) {
  const findings = [];
  const add = (rule, file, line, key, message) => findings.push({ rule, severity: RULES[rule].severity, file: path.relative(setup.root, file), line, key, message });
  const arbs = setup.files.map(loadArb);
  const tpl = arbs.find((a) => a.file === setup.template);
  const coverage = [];

  for (const a of arbs) {
    if (a.parseError) add('L03', a.file, 1, null, `Invalid JSON: ${a.parseError}`);
    const seen = new Map();
    for (const { key, line } of a.keys) {
      if (seen.has(key)) add('L04', a.file, line, key, `"${key}" appears twice (first on line ${seen.get(key)}); the later value silently wins`);
      else seen.set(key, line);
    }
  }
  if (!tpl || !tpl.data) return { findings, coverage, templateKeys: [] };

  const lineOf = (a, key) => (a.keys.find((k) => k.key === key) || {}).line || 1;
  const tKeys = Object.keys(tpl.data).filter(isMessageKey);
  const esc = /^true$/i.test(setup.cfg['use-escaping'] || '');
  const ph = (m) => placeholders(m, esc), bal = (m) => bracesBalanced(m, esc);

  for (const key of tKeys) {
    const msg = tpl.data[key];
    if (typeof msg !== 'string') continue;
    if (!bal(msg)) add('L03', tpl.file, lineOf(tpl, key), key, 'Unbalanced { } in template message');
    const meta = tpl.data['@' + key];
    const used = ph(msg);
    const declared = new Set(Object.keys((meta && meta.placeholders) || {}));
    for (const p of used) if (!declared.has(p)) add('L06', tpl.file, lineOf(tpl, key), key, `{${p}} has no entry in "@${key}".placeholders; gen-l10n infers the type (Object/String); declare it for a typed, formatted parameter`);
  }

  for (const a of arbs) {
    if (a === tpl || !a.data) continue;
    const locale = localeOf(a.file, setup.prefix);
    let translated = 0;
    const missing = [], same = [];
    for (const key of tKeys) {
      const tMsg = tpl.data[key];
      if (typeof tMsg !== 'string') continue;
      if (!(key in a.data)) { missing.push(key); continue; }
      const msg = a.data[key];
      if ((typeof msg !== 'string' || msg.trim() === '') && tMsg.trim() === '') { translated++; continue; }
      if (typeof msg !== 'string' || msg.trim() === '') { add('L05', a.file, lineOf(a, key), key, 'Empty value; users will see a blank'); continue; }
      translated++;
      if (!bal(msg)) { add('L03', a.file, lineOf(a, key), key, 'Unbalanced { }; gen-l10n will fail'); continue; }
      const want = ph(tMsg), got = ph(msg);
      const lost = [...want].filter((p) => !got.has(p)), extra = [...got].filter((p) => !want.has(p));
      if (lost.length || extra.length) {
        add('L02', a.file, lineOf(a, key), key, [lost.length && `missing {${lost.join('}, {')}}`, extra.length && `unknown {${extra.join('}, {')}}`].filter(Boolean).join('; '));
      }
      if (msg === tMsg && /[A-Za-z]{4,}/.test(msg.replace(/\{[^}]*\}/g, ''))) same.push(key);
    }
    if (missing.length) {
      const shown = missing.slice(0, 8).join(', ') + (missing.length > 8 ? `, … +${missing.length - 8} more` : '');
      add('L01', a.file, 1, null, `${missing.length} key(s) missing in "${locale}": ${shown}`);
    }
    if (same.length) {
      const shown = same.slice(0, 6).join(', ') + (same.length > 6 ? `, … +${same.length - 6} more` : '');
      add('L09', a.file, lineOf(a, same[0]), null, `${same.length} key(s) identical to the template in "${locale}": ${shown}`);
    }
    for (const key of Object.keys(a.data).filter(isMessageKey)) {
      if (!(key in tpl.data)) add('L08', a.file, lineOf(a, key), key, `"${key}" exists only in "${locale}"; it is ignored by gen-l10n`);
    }
    const total = tKeys.filter((k) => typeof tpl.data[k] === 'string').length;
    coverage.push({ locale, file: path.relative(setup.root, a.file), translated, total, percent: total ? Math.round((translated / total) * 1000) / 10 : 100 });
  }
  coverage.sort((x, y) => x.percent - y.percent);
  coverage.unshift({ locale: localeOf(tpl.file, setup.prefix) + ' (template)', file: path.relative(setup.root, tpl.file), translated: tKeys.length, total: tKeys.length, percent: 100 });
  return { findings, coverage, templateKeys: tKeys };
}

// Hardcoded strings: literal text passed where users read it.
const UI_PATTERNS = [
  /\bText\(\s*(['"])((?:\\.|(?!\1).)*)\1/g,
  /\b(?:hintText|labelText|helperText|errorText|tooltip|semanticLabel|title|subtitle|label|message|content)\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/g,
  /\bTextSpan\(\s*text\s*:\s*(['"])((?:\\.|(?!\1).)*)\1/g,
];

function looksLikeUserText(s) {
  if (s.length < 2) return false;
  if (/^\$\{?\w+\}?$/.test(s)) return false; // pure interpolation
  const letters = s.replace(/\$\{[^}]*\}|\$\w+/g, '').replace(/[^\p{L}]/gu, '');
  if (letters.length < 2) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(s) && !/\s/.test(s) && s.length < 25 && /[A-Z_]/.test(s)) return false; // camelCase id
  if (/^[a-z0-9_./:-]+$/.test(s)) return false; // keys, routes, asset paths, urls
  if (/^https?:|^assets\//.test(s)) return false;
  return true;
}

function auditDart(root, templateKeys, opts) {
  const findings = [];
  const lib = path.join(root, 'lib');
  const files = walk(lib, (p) => p.endsWith('.dart') && !/\.(g|freezed|gr|config|mocks)\.dart$/.test(p) && !/[\\/]l10n[\\/]|[\\/]generated[\\/]|app_localizations/.test(p));
  const usage = new Set();
  let usesL10n = false;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (/AppLocalizations|\bS\.of\(|\bS\.current|context\.l10n|\bl10n\.|\.tr\(\)|intl\.dart/.test(src)) usesL10n = true;
    for (const m of src.matchAll(/\.(\w+)\b/g)) usage.add(m[1]);
    if (!opts.hardcoded) continue;
    const lines = src.split('\n');
    lines.forEach((line, idx) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('import ') || t.startsWith('export ') || t.startsWith('part ') || /debugPrint|print\(|log\(|throw |assert\(|Exception\(|@override/.test(t)) return;
      if (/\/\/\s*l10n-ignore/.test(line)) return;
      for (const re of UI_PATTERNS) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line))) {
          const s = m[2].replace(/\\(['"$])/g, '$1');
          if (looksLikeUserText(s)) findings.push({ rule: 'L07', severity: 'warning', file: path.relative(root, f), line: idx + 1, key: null, message: `"${s.length > 60 ? s.slice(0, 57) + '...' : s}" is not translated; move it to the ARB file` });
        }
      }
    });
  }
  if (opts.unused && usesL10n && templateKeys.length) {
    const unused = templateKeys.filter((k) => !usage.has(k));
    if (unused.length && unused.length < templateKeys.length) {
      const shown = unused.slice(0, 10).join(', ') + (unused.length > 10 ? `, … +${unused.length - 10} more` : '');
      findings.push({ rule: 'L10', severity: 'info', file: 'lib/', line: 0, key: null, message: `${unused.length} of ${templateKeys.length} keys never referenced: ${shown}` });
    }
  }
  return { findings, dartFiles: files.length, usesL10n };
}

function audit(root, opts = {}) {
  opts = { hardcoded: true, unused: true, ...opts };
  root = path.resolve(root);
  const setup = findArbSetup(root);
  const arb = setup ? auditArb(setup) : { findings: [], coverage: [], templateKeys: [] };
  const dart = auditDart(root, arb.templateKeys, opts);
  const findings = [...arb.findings, ...dart.findings];
  const counts = { error: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const hardcoded = findings.filter((f) => f.rule === 'L07').length;
  return {
    root, arbDir: setup ? path.relative(root, setup.arbDir) : null, template: setup ? path.relative(root, setup.template) : null,
    locales: arb.coverage.length, keys: arb.templateKeys.length, dartFiles: dart.dartFiles, usesL10n: dart.usesL10n,
    coverage: arb.coverage, hardcoded, counts, findings,
  };
}

// ── output ────────────────────────────────────────────────────────────────────

function bar(p) { const n = Math.round(p / 5); return '█'.repeat(n) + '░'.repeat(20 - n); }

function printReport(r) {
  const out = [];
  out.push(`flutter-l10n-audit · ${path.basename(r.root)}`);
  if (!r.arbDir) out.push('No .arb files found (no l10n.yaml, lib/l10n or assets/l10n). Only hardcoded strings were checked.');
  else out.push(`ARB: ${r.arbDir} · template ${path.basename(r.template)} · ${r.keys} keys · ${r.locales} locale(s) · ${r.dartFiles} Dart files`);
  if (r.coverage.length) {
    out.push('', 'Translation coverage');
    for (const c of r.coverage) out.push(`  ${c.locale.padEnd(16)} ${bar(c.percent)} ${String(c.percent).padStart(5)}%  ${c.translated}/${c.total}`);
  }
  out.push('', `Hardcoded UI strings: ${r.hardcoded}`, `Findings: ${r.counts.error} error · ${r.counts.warning} warning · ${r.counts.info} info`);
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...r.findings].sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule));
  let lastRule = '';
  for (const f of sorted) {
    if (f.rule !== lastRule) { out.push('', `${f.rule} ${RULES[f.rule].title} [${f.severity}]`); lastRule = f.rule; }
    out.push(`  ${f.file}${f.line ? ':' + f.line : ''}  ${f.key ? f.key + ': ' : ''}${f.message}`);
  }
  return out.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (n) => args.includes(n);
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  if (flag('--help') || flag('-h')) {
    console.log('usage: l10n-audit [project-dir] [--json] [--fail-on error|warning|info] [--no-hardcoded] [--no-unused]');
    return 0;
  }
  const failOn = val('--fail-on');
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--fail-on') || '.';
  if (!fs.existsSync(dir)) { console.error(`not found: ${dir}`); return 2; }
  const r = audit(dir, { hardcoded: !flag('--no-hardcoded'), unused: !flag('--no-unused') });
  console.log(flag('--json') ? JSON.stringify(r, null, 2) : printReport(r));
  if (failOn) {
    const min = SEVERITY[failOn];
    if (!min) { console.error('--fail-on must be error, warning or info'); return 2; }
    if (r.findings.some((f) => SEVERITY[f.severity] >= min)) return 1;
  }
  return 0;
}

module.exports = { audit, placeholders, bracesBalanced, topLevelKeys, looksLikeUserText, RULES };
if (require.main === module) process.exitCode = main(process.argv);
