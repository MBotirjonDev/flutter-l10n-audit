---
name: flutter-l10n-audit
description: Audits a Flutter app's localization (gen-l10n ARB files and lib/ Dart code) and reports per-locale translation coverage, missing keys, placeholder mismatches, broken ICU plural/select messages, duplicate ARB keys and hardcoded user-facing strings. Use when the user asks to check, fix or finish translations in a Flutter app, adds a new language, sees gen-l10n errors, or wants to know which texts are still not translated.
---

# Flutter localization audit

A Flutter app usually ships its translations half-done without anyone noticing: a translator
renames `{name}` to `{ism}`, a plural loses a `}`, a key is copied twice, a new screen uses
`Text('Buy now')`. Each one is either a build error, a blank or English text for real users.
This skill measures all of it with one script and then fixes what it found.

## Principles

- Measure first. Run the script; do not guess coverage from a glance at the ARB files.
- The template ARB (`template-arb-file` in `l10n.yaml`, else `app_en.arb`) is the source of
  truth. Never "fix" a mismatch by changing the template unless the template is wrong.
- Placeholders must keep their exact names. Word order may change; names may not.
- Do not machine-translate silently. When you add missing translations, say which locale and
  keys you filled and mark them for review by a native speaker.
- Respect `// l10n-ignore` on a Dart line: the developer decided that string stays as is.

## Workflow

1. Run the audit from the Flutter project root (the folder with `pubspec.yaml`):
   ```sh
   node <skill-dir>/scripts/l10n-audit.cjs . 
   ```
   Add `--json` for machine-readable output, `--fail-on error` for CI,
   `--no-hardcoded` or `--no-unused` to skip those checks.
2. Report the coverage table and the counts first, then the errors, then warnings.
3. Fix in this order, re-running the script after each group:
   1. L03 broken ICU and L04 duplicate keys: these break `flutter gen-l10n` or silently
      replace a translation.
   2. L02 placeholder mismatches: restore the template's placeholder names in the locale.
   3. L01 missing keys and L05 empty values: add the keys to each locale. If you write the
      translation yourself, tell the user it needs native review.
   4. L07 hardcoded strings: add a key to the template ARB (with `@key` metadata and
      placeholders for any interpolation), use `AppLocalizations.of(context)!.key` in the
      widget, then add the key to the other locales.
   5. L06, L08, L09, L10 are informational: declare placeholders, delete keys that exist only
      in one locale, check copies of the English text, remove unused keys only after the user
      agrees.
4. Finish with `flutter gen-l10n` (or `flutter pub get`) if the user can run Flutter, and
   the audit again. Show the before and after coverage.

## Rules

See `references/rules.md` for what each rule means, why it matters and how to fix it.

| Rule | Severity | Finds |
|---|---|---|
| L01 | error | keys in the template missing from a locale |
| L02 | error | placeholder names differ from the template |
| L03 | error | unbalanced `{ }` in an ICU message, invalid JSON |
| L04 | error | the same key twice in one ARB file |
| L05 | warning | empty value where the template has text |
| L06 | info | placeholder used without `@key.placeholders` entry |
| L07 | warning | literal text in `Text()`, `hintText:`, `tooltip:` and similar |
| L08 | info | key only in a locale, not in the template |
| L09 | info | value identical to the template (likely untranslated) |
| L10 | info | template key never referenced in `lib/` |

## Limits

- Reads ARB (gen-l10n / intl). Projects using `easy_localization` JSON or `slang` YAML are
  only checked for hardcoded strings.
- L07 works on single lines and common widget parameters; it can miss strings built across
  lines and can flag debug-only screens. L10 is a text search for `.key`, so dynamic access
  is not seen.
- The script reads files only. It writes nothing and makes no network calls.
