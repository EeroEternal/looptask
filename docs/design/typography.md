# Typography

Typography is system-based and utilitarian. The admin UI should favor clarity and stability over personality fonts.

- Headlines use the sans stack with semibold or bold weight for page titles and primary section headers.
- Body text stays in the sans stack and should remain readable in dense forms, tables, and settings panels.
- Technical identifiers such as API keys, model slugs, request IDs, and command samples use the mono stack.
- Small metadata should reduce size, not contrast. `muted-foreground` carries secondary information.

Text hierarchy guidance:

- Page titles: compact single-line `text-xl` / semibold inside `PageHeader` (not `headline-lg`)
- Card titles: `title-md` / `font-semibold`; do not pair them with a default subtitle
- Explanatory copy: `body-sm` — use in empty states, dialogs, and error text; **not** as a subtitle under a page or card title
- Do not add a subtitle that repeats the title in different words (for example title「API 密钥」plus「仅显示属于该用户的密钥」)
- UI labels and compact badges: `label-md` or `label-sm`
- Keys, tokens, and code samples: `mono-sm`
- Live metrics and changing numeric values use tabular numbers to avoid layout jitter.

Long text handling is part of typography, not an afterthought:

- entity names and prose should use wrapping strategies such as `break-words` or `line-clamp-2`
- multi-line request/response bodies (logs, chat) use `whitespace-pre-wrap break-words [overflow-wrap:anywhere]` so Chinese and English both wrap cleanly; do not use `break-all` on prose (it splits CJK mid-phrase and long Latin tokens poorly)
- keep expand/collapse controls on their own line under the body, not inline at the end of the paragraph
- keys, IDs, and model slugs may use `break-all`
- avoid assuming a single line for Chinese or translated copy
