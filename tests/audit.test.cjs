'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { audit, placeholders, bracesBalanced, topLevelKeys, looksLikeUserText } = require('../skills/flutter-l10n-audit/scripts/l10n-audit.cjs');

const ex = (n) => path.join(__dirname, '..', 'examples', n);
const rules = (r) => r.findings.map((f) => f.rule);

function project(arbs, dart = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l10n-'));
  fs.mkdirSync(path.join(dir, 'lib', 'l10n'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'l10n.yaml'), 'arb-dir: lib/l10n\ntemplate-arb-file: app_en.arb\n');
  for (const [name, body] of Object.entries(arbs)) fs.writeFileSync(path.join(dir, 'lib', 'l10n', name), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  if (dart) fs.writeFileSync(path.join(dir, 'lib', 'main.dart'), dart);
  return dir;
}

test('placeholders: simple, plural, nested text and quoted braces', () => {
  assert.deepStrictEqual([...placeholders('Hi {name}!')], ['name']);
  assert.deepStrictEqual([...placeholders('{count, plural, =0{None} =1{One item} other{{count} items for {name}}}')].sort(), ['count', 'name']);
  assert.deepStrictEqual([...placeholders("{n, plural, other{Hello {user}}}")].sort(), ['n', 'user']);
  assert.deepStrictEqual([...placeholders("Use '{braces}' literally", true)], []);
  assert.deepStrictEqual([...placeholders("Delete '{item}'?")], ['item']); // Flutter default: no escaping
  assert.deepStrictEqual([...placeholders('{g, select, male{He} female{She} other{They}} left')], ['g']);
  assert.deepStrictEqual([...placeholders('{price, number, currency}')], ['price']);
});

test('bracesBalanced and duplicate key scanner', () => {
  assert.ok(bracesBalanced('{a, plural, other{{a} x}}'));
  assert.ok(!bracesBalanced('{a, plural, other{{a} x}'));
  assert.ok(bracesBalanced("'{' is literal", true));
  assert.deepStrictEqual(topLevelKeys('{"a": {"b": 1}, "c": "x", "a": 2}').map((k) => k.key), ['a', 'c', 'a']);
});

test('looksLikeUserText skips ids, paths and interpolation', () => {
  for (const s of ['Save', 'Promo code', 'Xush kelibsiz', 'Корзина']) assert.ok(looksLikeUserText(s), s);
  for (const s of ['assets/a.png', 'home_screen', '/settings', '$name', '${user.name}', 'https://x.uz', 'userId', '42']) assert.ok(!looksLikeUserText(s), s);
});

test('broken example triggers every ARB rule, clean example none', () => {
  const r = audit(ex('broken_app'));
  for (const rule of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10']) assert.ok(rules(r).includes(rule), rule);
  const clean = audit(ex('clean_app'));
  assert.deepStrictEqual(clean.findings, []);
  assert.ok(clean.coverage.every((c) => c.percent === 100));
});

test('L01 missing / L08 extra keys', () => {
  const dir = project({ 'app_en.arb': { a: 'A text', b: 'B text' }, 'app_uz.arb': { a: 'A matn', z: 'Z matn' } });
  const r = audit(dir);
  assert.ok(rules(r).includes('L01'));
  assert.ok(rules(r).includes('L08'));
  assert.strictEqual(r.coverage.find((c) => c.locale === 'uz').percent, 50);
  const ok = audit(project({ 'app_en.arb': { a: 'A text' }, 'app_uz.arb': { a: 'A matn' } }));
  assert.ok(!rules(ok).includes('L01') && !rules(ok).includes('L08'));
});

test('L02 placeholder mismatch, not raised for reordered placeholders', () => {
  const bad = audit(project({ 'app_en.arb': { w: 'Hi {name}', '@w': { placeholders: { name: {} } } }, 'app_ru.arb': { w: 'Привет {imya}' } }));
  assert.ok(rules(bad).includes('L02'));
  const ok = audit(project({ 'app_en.arb': { w: '{a} and {b}', '@w': { placeholders: { a: {}, b: {} } } }, 'app_ru.arb': { w: '{b} и {a}' } }));
  assert.ok(!rules(ok).includes('L02'));
});

test('L03 broken ICU and invalid JSON', () => {
  const r = audit(project({ 'app_en.arb': { c: '{n, plural, other{{n} x}}', '@c': { placeholders: { n: {} } } }, 'app_uz.arb': { c: '{n, plural, other{{n} ta}' } }));
  assert.ok(rules(r).includes('L03'));
  const j = audit(project({ 'app_en.arb': { a: 'A text' }, 'app_uz.arb': '{"a": "x",}' }));
  assert.ok(rules(j).includes('L03'));
});

test('L04 duplicate key only when really duplicated', () => {
  const r = audit(project({ 'app_en.arb': { a: 'A text' }, 'app_uz.arb': '{"a": "x", "a": "y"}' }));
  assert.ok(rules(r).includes('L04'));
  const ok = audit(project({ 'app_en.arb': { a: 'A text', '@a': { description: 'a' } }, 'app_uz.arb': { a: 'x' } }));
  assert.ok(!rules(ok).includes('L04'));
});

test('L05 empty translation', () => {
  assert.ok(rules(audit(project({ 'app_en.arb': { a: 'A text' }, 'app_uz.arb': { a: ' ' } }))).includes('L05'));
  assert.ok(!rules(audit(project({ 'app_en.arb': { a: 'A text' }, 'app_uz.arb': { a: 'x' } }))).includes('L05'));
  assert.ok(!rules(audit(project({ 'app_en.arb': { sep: '' }, 'app_uz.arb': { sep: '' } }))).includes('L05')); // empty on purpose
});

test('L06 undeclared placeholder in template', () => {
  assert.ok(rules(audit(project({ 'app_en.arb': { t: 'Total {sum}' } }))).includes('L06'));
  assert.ok(!rules(audit(project({ 'app_en.arb': { t: 'Total {sum}', '@t': { placeholders: { sum: {} } } } }))).includes('L06'));
});

test('L07 hardcoded strings, with ignore comment and non-UI strings skipped', () => {
  const dart = [
    "Text('Buy now'),",
    "InputDecoration(labelText: 'Phone number'),",
    "Text(l10n.title),",
    "Image.asset('assets/logo.png'),",
    "Navigator.pushNamed(context, '/home');",
    "print('debug message here');",
    "Text('Botirjon'), // l10n-ignore",
  ].join('\n');
  const r = audit(project({ 'app_en.arb': { title: 'Title' } }, dart));
  const hits = r.findings.filter((f) => f.rule === 'L07').map((f) => f.line);
  assert.deepStrictEqual(hits, [1, 2]);
  assert.strictEqual(audit(project({ 'app_en.arb': { title: 'T' } }, dart), { hardcoded: false }).hardcoded, 0);
});

test('L09 same text as template, brand-like short strings ignored', () => {
  assert.ok(rules(audit(project({ 'app_en.arb': { a: 'Contact us' }, 'app_uz.arb': { a: 'Contact us' } }))).includes('L09'));
  assert.ok(!rules(audit(project({ 'app_en.arb': { a: 'OK' }, 'app_uz.arb': { a: 'OK' } }))).includes('L09'));
});

test('L10 unused keys only when the app uses l10n', () => {
  const arbs = { 'app_en.arb': { used: 'U', unused: 'X' } };
  assert.ok(rules(audit(project(arbs, 'final l = AppLocalizations.of(context)!;\nText(l.used);'))).includes('L10'));
  assert.ok(!rules(audit(project(arbs, "Text(foo);"))).includes('L10'));
});

test('no ARB files: hardcoded strings still reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l10n-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.writeFileSync(path.join(dir, 'lib', 'main.dart'), "Text('Hello world')");
  const r = audit(dir);
  assert.strictEqual(r.arbDir, null);
  assert.strictEqual(r.hardcoded, 1);
});

test('CLI exit codes', () => {
  const { spawnSync } = require('child_process');
  const cli = path.join(__dirname, '..', 'skills', 'flutter-l10n-audit', 'scripts', 'l10n-audit.cjs');
  assert.strictEqual(spawnSync(process.execPath, [cli, ex('broken_app'), '--fail-on', 'error']).status, 1);
  assert.strictEqual(spawnSync(process.execPath, [cli, ex('clean_app'), '--fail-on', 'info']).status, 0);
  const j = JSON.parse(spawnSync(process.execPath, [cli, ex('broken_app'), '--json']).stdout);
  assert.ok(j.coverage.length === 3);
});
