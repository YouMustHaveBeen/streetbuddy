# Отклоненное

Что было убрано из проекта.

## Приложение Userscripts для iPhone

Убрано из страниц `/manual` и `/install`, из вопроса бота «Your phone?» и из `docs/architecture.md`. Файл скрипта и `/streetbuddy.user.js` остаются: их загружает закладка. Ниже убранные куски, как они были.

### Страница /install (src/install.ts), выбор способа для iPhone

```
<div data-for="iphone-bookmark iphone-script" hidden>
<p>На iPhone есть два способа, оба работают только в Safari. Выберите один:</p>
<p class="choice"><button type="button" aria-pressed="true" data-method="bookmark">Закладка</button><button type="button" aria-pressed="false" data-method="script">Приложение Userscripts</button></p>
<div data-for="iphone-bookmark" hidden>
<p>Ваши личные данные будут храниться в закладке Safari: при запуске закладка загружает с сайта StreetBuddy скрипт, который добавляет эти данные в форму репорта. Приложение ставить не нужно, но закладку надо запускать на каждом репорте. Для запуска нужен интернет.</p>
</div>
<div data-for="iphone-script" hidden>
<p>Приложение Userscripts запускает скрипт на форме репорта само. Ваши личные данные вы введете один раз, на форме при первом репорте, и они будут храниться в приложении на телефоне. Настройка чуть длиннее, зато закладку запускать не нужно.</p>
</div>
```

### Страница /install (src/install.ts), шаги установки приложения и скрипта

```
<div data-for="iphone-script" hidden>
<h3>2. Установите приложение и включите его в Safari</h3>
<p>Установите бесплатное приложение <a href="https://apps.apple.com/app/userscripts/id1463298887">Userscripts</a> из App Store и откройте его один раз.</p>
<p>Откройте настройки iPhone, затем «Safari» (на новых версиях iOS «Apps», «Safari»), «Extensions», Userscripts. Включите расширение и разрешите его для всех сайтов («Allow»).</p>

<h3>3. Установите скрипт</h3>
<p>Нажмите кнопку, откроется страница с кодом скрипта:</p>
<p><a class="install" id="script-link" href="${SCRIPT_PATH}">Открыть скрипт</a></p>
<p>На этой странице откройте меню расширений Safari (значок слева в адресной строке, на новых версиях iOS «⋯»), нажмите Userscripts, затем предложение установить скрипт, и подтвердите установку.</p>
</div>
```

### Страница /install (src/install.ts), шаги репорта для Userscripts

```
<p data-for="iphone-script" hidden>Бот покажет готовое описание и спросит «Is everything correct?»: нажмите «Yes, it’s correct». Если бот еще не знает ваш телефон (в первый раз), он спросит «Your phone?»: нажмите «iPhone Userscripts».</p>
```

### Страница /install (src/install.ts), шаги репорта для Userscripts

```
<p data-for="iphone-script" hidden>Когда форма откроется, вверху страницы появится панель с полями. Она появляется только в первый раз: введите ваши данные и нажмите «Save». Если панели нет, откройте меню расширений Safari и проверьте, что Userscripts разрешено работать на этой странице.</p>
```

### Страница /install (src/install.ts), шаги репорта для Userscripts

```
<p data-for="iphone-script" hidden>На этом установка закончена, вы можете пользоваться ботом. Скрипт будет запускаться на форме сам.</p>
```

### Страница /manual (src/manual.ts), шаг 7

```
«iPhone Userscripts»
```

### Страница /manual (src/manual.ts), раздел «Перед началом» для iPhone

```
или скрипт в приложении Userscripts
```

### Страница /manual (src/manual.ts), шаг 7 для iPhone

```
а закладка и скрипт там не работают
```

### Страница /manual (src/manual.ts), шаг 8 для iPhone

```
<p>Если вы пользуетесь закладкой: когда форма Traffic Watch Online Reporting откроется в Safari, нажмите «⋯» внизу, «Bookmarks» и qqqwww.</p>
<p>Если вы пользуетесь приложением Userscripts, этот шаг не нужен: скрипт запускается сам. В первый раз он покажет вверху страницы панель с полями: введите ваши данные и нажмите «Save».</p>
```

### Страница /manual (src/manual.ts), раздел «Полезно знать» для iPhone

```
они хранятся только на вашем телефоне, в закладке или в приложении Userscripts.
```

### Бот (src/telegram/dialog.ts), шаги итогового сообщения для телефона «iPhone Userscripts»

```
  iphone_userscripts: `-> Press “Open report”,
-> «⋯» on the top and “Open in Safari”,
-> fill and send the report,
-> press “Done” to close the form.`,
```

### Бот (src/telegram/dialog.ts), кнопка вопроса «Your phone?»

```
  [{ text: "iPhone Userscripts", callback_data: `${PHONE_PREFIX}iphone_userscripts` }],
```

### docs/architecture.md, п.13

```
iPhone — Safari с приложением «Userscripts» (оно работает только в Safari) или закладка в Safari; способ выбирается на странице инструкции.
```

### docs/architecture.md, п.15

```
один раз: юзерскрипт просит их при первом открытии формы и сохраняет в хранилище расширения; для закладки их вводят на странице инструкции, и страница
```

### docs/architecture.md, п.38

```
Один код, две формы доставки: юзерскрипт (приложение «Userscripts» на iPhone) и закладка; в закладку вшиты
```

### docs/architecture.md, п.38

```
 Юзерскрипт обновляется по адресу `/streetbuddy.user.js` из своей шапки (`@updateURL`, `@downloadURL`), поэтому при каждом изменении скрипта поднимается `@version`.
```

### docs/architecture.md, п.39

```
юзерскрипт запускается как можно раньше после загрузки, закладка — когда пользователь ее коснется.
```

### docs/architecture.md, п.42

```
Личные данные юзерскрипт хранит в хранилище расширения, где их можно изменить или удалить; в закладке они вшиты в ее код (
```

### docs/architecture.md, п.48

```
 Для iPhone под кнопками «Android» и «iPhone» появляются две кнопки способа, «Закладка» и «Приложение Userscripts». Закладка собирается той же формой, ее сохраняют в Safari и запускают на открытой форме из списка закладок. Для Userscripts страница ведет к приложению в App Store и к файлу скрипта; личные данные скрипт просит на форме при первом запуске (п.15).
```

### docs/architecture.md, п.83

```
из англоязычного интерфейса; запуск описан для обоих способов установки. Русский
```

### docs/architecture.md, п.60

```
Юзерскрипт на iPhone (приложение «Userscripts») обновляется по адресу из своей шапки, поэтому код, который он исполняет на форме с личными данными, тоже может менять оператор бота; это указывается в политике.
```

### docs/architecture.md, п.92

```
«iPhone bookmark», «iPhone Userscripts», «Android», «Cancel»
```

### docs/pending.md, п.14

```
; в приложении «Userscripts» на iPhone способ не проверен (п.42).
```
