# StreetBuddy — архитектура

Полное ТЗ: https://claude.ai/artifact/VjyfWZQdmtaddSdGiXbSNo

Один Cloudflare Worker (TypeScript, деплой через wrangler).

## Структура репозитория

- `src/index.ts` — точка входа Worker (вебхук Telegram, ежедневная проверка формы).
- `src/core` — логика, не зависящая от мессенджера: распознавание номера, геокодирование, проверка района, шаблоны описаний, сборка ссылки.
- `src/telegram` — диалог, кнопки, шаг текущей жалобы.
- `userscript/` — скрипт заполнения формы; закладка собирается из него автоматически.
- `config/area.geojson` — граница района и графство.
- `wrangler.toml` — привязки AI и D1, расписание (5:00 и 6:00 UTC), переменные.

## Секреты и переменные

- Секреты: `TELEGRAM_BOT_TOKEN`, `WEBHOOK_SECRET`.
- Переменные: `OWNER_TELEGRAM_ID` (Telegram ID владельца бота), `GROUP_ID` (ID закрытой Telegram-группы).
