# In-room UI translations

Translation files in this folder apply to the in-room UI, not the landing page or user-generated content.

## Configuration

Set these environment variables, or the corresponding `config.ui.brand.app` fields in
[config.template.js](../../app/src/config.template.js):

```env
UI_TRANSLATION_MODE=native
UI_LANGUAGE=en
```

| Mode               | Behavior                                                    |
| ------------------ | ----------------------------------------------------------- |
| `google` (default) | Use Google Translate; ignore native JSON files              |
| `auto`             | Use the native language file if available, otherwise Google |
| `native`           | Use native files only; missing translations remain English  |

The config fields are `translationMode` and `language`. In native mode, switch languages
from Settings > Language. Browser language preferences override `UI_LANGUAGE`; reset to
the server default when testing configuration changes.

## Add or update a language

1. Copy [en.json](./en.json) to `<language-code>.json` (for example, `hu.json`) if the file does not exist.
2. Translate the **values** only. Keep English keys, punctuation, casing, and placeholders such as `{name}` unchanged.
3. For a new language, add its code, flag, and native name to `LANG_DISPLAY` in [I18n.js](../js/I18n.js).
4. Set `UI_TRANSLATION_MODE=native` or `auto`, select the language, and open a room to verify it.

Missing or empty values fall back to English, so partial translations are supported.

| Namespace  | UI content                                         |
| ---------- | -------------------------------------------------- |
| `tooltips` | Hover hints                                        |
| `buttons`  | Button text, attributes, and dynamic menu captions |
| `labels`   | Static text, headings, and label attributes        |
| `dialogs`  | Popup titles, text, buttons, and inputs            |
| `toasts`   | Notifications                                      |

To exclude an HTML element from translation, use `class="notranslate"`, `translate="no"`,
or `data-i18n-skip`.

Toast notifications are translated when displayed.
Use literal messages in `userLog()` calls so the extractor can discover toast keys;
for conditional messages, put each literal in its own branch.
Keep lifecycle callbacks in the options passed to `Swal.fire()`
so the translation wrapper preserves them.

## Synchronize translation keys

Run from the repository root after changing UI strings:

```bash
node app/src/scripts/extract-ui-lang.js
```

This regenerates `en.json` and synchronizes the other language files, preserving existing
translations, keeping keys in the same order as `en.json`, adding missing keys with English values,
and removing stale keys. Review the diff.

Dynamic video and participant dropdown captions (including conditional presenter actions)
are extracted into `buttons`. Translate newly added English values in each locale before shipping;
matching values can also be intentional for brands, technical identifiers, or shared vocabulary.
