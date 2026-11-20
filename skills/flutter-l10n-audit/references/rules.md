# Rules

Each rule: what it finds, why it matters, how to fix.

## L01 Missing translation (error)
A key in the template ARB is absent from a locale file. gen-l10n falls back to the template
language, so those users see English (or whatever the template is) in the middle of their UI.
Fix: add the key to the locale. Mark machine-written translations for native review.

## L02 Placeholder mismatch (error)
The locale message uses different placeholder names than the template, e.g. template
`Welcome, {name}` and locale `Xush kelibsiz, {ism}`. gen-l10n generates a method from the
template's placeholders, so a renamed placeholder is printed literally or the build fails; a
missing one silently drops the value (a price, a user name, a count).
Fix: use exactly the template's names. Word order may differ.

## L03 Broken ICU message (error)
Unbalanced `{` `}` (usually in a plural or select) or a file that is not valid JSON.
`flutter gen-l10n` stops with an error. With `use-escaping: true` in `l10n.yaml`, text in
single quotes is treated as literal and ignored by this check, as gen-l10n does.
Fix: count the braces of each branch: `{count, plural, =0{...} other{{count} ...}}`.

## L04 Duplicate key (error)
The same key appears twice in one ARB file. JSON parsers keep the last one without a warning,
so one translation is lost and nobody notices.
Fix: keep one entry, the correct one.

## L05 Empty translation (warning)
The locale value is an empty string while the template has text: the widget shows nothing.
Empty strings that are empty in the template too (separators) are not reported.

## L06 Placeholder not declared (info)
The template uses `{amount}` but `@key.placeholders` has no `amount`. gen-l10n infers a type
(Object or String), so you lose typed parameters, number and date formatting.
Fix: add `"@key": { "placeholders": { "amount": { "type": "double", "format": "currency" } } }`.

## L07 Hardcoded user-facing string (warning)
A string literal is passed to `Text(...)`, `TextSpan(text:)` or a parameter users read:
`hintText`, `labelText`, `helperText`, `errorText`, `tooltip`, `semanticLabel`, `title`,
`subtitle`, `label`, `message`, `content`. It will never be translated.
Skipped: asset paths, routes, URLs, identifiers, pure interpolation, `print`/`debugPrint`/
`throw`/`assert` lines, generated files, and any line with `// l10n-ignore`.
Fix: add a template key (with placeholders for interpolated values), call it through
`AppLocalizations.of(context)!`, add it to every locale.

## L08 Key only in this locale (info)
The key is not in the template, so gen-l10n ignores it. Usually left over after a rename.
Fix: delete it, or add it to the template if it is new.

## L09 Possibly untranslated (info)
The locale value is identical to the template (and has 4+ letters). Often a copy waiting for
a translator; sometimes correct (brand names, "OK"). Reported once per locale with a list.

## L10 Key never used (info)
No `.keyName` reference in `lib/`. Shown only when the app uses AppLocalizations or similar.
Dynamic lookups are not visible to a text search, so confirm with the user before deleting.
