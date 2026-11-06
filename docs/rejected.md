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

## Панель личных данных в скрипте

Панель показывалась в приложении Userscripts при первом открытии формы; данные хранились в хранилище приложения. Убрана из скрипта вместе со всем, что нужно было только ей. Ниже убранные куски, как они были.

### Скрипт (userscript/streetbuddy.user.js), шапка

```
// @updateURL    https://streetbuddy.youmusthavebeen.workers.dev/streetbuddy.user.js
// @downloadURL  https://streetbuddy.youmusthavebeen.workers.dev/streetbuddy.user.js
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
```

### Скрипт (userscript/streetbuddy.user.js), комментарий вверху

```
// StreetBuddy form-filling script: the userscript and the bookmarklet both run this same file.
```

### Скрипт (userscript/streetbuddy.user.js), константы

```
  const PANEL_ID = "streetbuddy-profile";
  const PROFILE_KEY = "profile";
```

### Скрипт (userscript/streetbuddy.user.js), forgetReport

```
  // Drops the link data on submit events, except for the panel for personal data.
  function forgetReport(event) {
    if (event.target && event.target.id === PANEL_ID) return;
```

### Скрипт (userscript/streetbuddy.user.js), хранилище приложения

```
  // Extension storage on the phone.
  function pickStorage() {
    if (typeof GM !== "undefined" && GM && typeof GM.getValue === "function") {
      return { get: (key) => GM.getValue(key), set: (key, value) => GM.setValue(key, value) };
    }
    if (typeof GM_getValue === "function") {
      return {
        get: async (key) => GM_getValue(key),
        set: async (key, value) => GM_setValue(key, value),
      };
    }
    return null;
  }
```

### Скрипт (userscript/streetbuddy.user.js), loadProfile

```
  async function loadProfile(storage) {
    if (globalThis.STREETBUDDY_PROFILE) return validateProfile(globalThis.STREETBUDDY_PROFILE);
    if (!storage) return null;
    try {
      const stored = await storage.get(PROFILE_KEY);
      return stored ? validateProfile(JSON.parse(stored)) : null;
    } catch {
      return null;
    }
  }
```

### Скрипт (userscript/streetbuddy.user.js), панель личных данных и ее поля

```
  function field(labelText, control) {
    const label = document.createElement("label");
    label.style.cssText = "display:block;margin:8px 0";
    label.append(labelText, document.createElement("br"), control);
    return label;
  }

  function textInput(type) {
    const input = document.createElement("input");
    input.type = type;
    input.required = true;
    input.style.cssText = "width:100%;box-sizing:border-box;font-size:16px";
    return input;
  }

  function selectInput(options) {
    const select = document.createElement("select");
    select.required = true;
    select.style.cssText = "width:100%;box-sizing:border-box;font-size:16px";
    for (const text of options) select.append(new Option(text, text));
    select.selectedIndex = -1;
    return select;
  }

  // Asks for the personal data.
  function showProfilePanel(onSave) {
    const panel = document.createElement("form");
    panel.id = PANEL_ID;
    panel.style.cssText = "padding:12px;margin:8px;border:2px solid #444;background:#fff;color:#000;font:16px sans-serif";
    const name = textInput("text");
    const phone = textInput("tel");
    const email = textInput("email");
    const address = textInput("text");
    const contact = selectInput(CONTACT_METHODS);
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    save.style.cssText = "font-size:16px;padding:8px 16px";
    panel.append(
      field("First Name and Last Name", name),
      field("Phone", phone),
      field("Email", email),
      field("Address", address),
      field("How you wish to be contacted", contact),
      save,
    );
    panel.addEventListener("submit", async (event) => {
      event.preventDefault();
      const profile = validateProfile({
        name: name.value,
        phone: phone.value,
        email: email.value,
        address: address.value,
        contact: contact.value,
      });
      if (!profile) return;
      panel.remove();
      await onSave(profile);
    });
    document.body.prepend(panel);
  }
```

### Скрипт (userscript/streetbuddy.user.js), запуск (run)

```
  async function run() {
    const storage = pickStorage();
    let profile = await loadProfile(storage);
    onReady(() => {
      // Drops the saved link data on a submit event.
      document.addEventListener("submit", forgetReport, true);
      if (link.invalid) showMessage(MESSAGE_LINK_INVALID);
      const start = () => {
        if (link.report && profile) waitAndFill(link.report, profile);
      };
      if (!profile && storage) {
        showProfilePanel(async (saved) => {
          await storage.set(PROFILE_KEY, JSON.stringify(saved));
          profile = saved;
          start();
        });
      } else {
        start();
      }
    });
  }
```

### Браузерный тест (test/userscript/userscript.browser.ts), подготовка страницы с данными из хранилища приложения

```
// A new context is a new browser profile: its session storage starts empty.
// `changeForm` edits the page text before the browser gets it (to take a field or option away).
// `stored` is the personal data in the extension storage; null means none is saved yet.
async function newContext(
  changeForm?: (html: string) => string,
  stored: object | null = PROFILE,
): Promise<BrowserContext> {
  const context = await browser.newContext();
  // One init script: the order of several scripts is not guaranteed, and the script reads GM at once.
  const saved = stored === null ? "undefined" : JSON.stringify(JSON.stringify(stored));
  const gmMock = `globalThis.GM = { getValue: async (key) => (key === "profile" ? ${saved} : undefined), setValue: async () => {} };`;
  await context.addInitScript(`${gmMock}\n${SCRIPT}`);
  if (changeForm) {
    await context.route(`**${FORM_PATH}`, (route) =>
      route.fulfill({ contentType: "text/html; charset=utf-8", body: changeForm(FORM_HTML) }),
    );
  }
  return context;
}
```

### Браузерный тест (test/userscript/userscript.browser.ts), тесты данных из хранилища приложения и панели

```
  it("fills the form with personal data saved by an older version that also kept Were you a", async () => {
    const context = await newContext(undefined, { ...PROFILE, roadUser: "Driver" });
    const page = await context.newPage();
    const report = ordinaryReport();
    await page.goto(linkTo(report));
    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual(expectedValues(report));
    await context.close();
  });

  it("asks for the personal data without Were you a, then fills the form", async () => {
    const context = await newContext(undefined, null);
    const page = await context.newPage();
    const report = ordinaryReport();
    await page.goto(linkTo(report));
    const panel = page.locator("#streetbuddy-profile");
    await panel.waitFor();
    expect((await panel.locator("label").allInnerTexts()).map((label) => label.split("\n")[0])).toEqual([
      "First Name and Last Name",
      "Phone",
      "Email",
      "Address",
      "How you wish to be contacted",
    ]);
    const inputs = panel.locator("input");
    await inputs.nth(0).fill(PROFILE.name);
    await inputs.nth(1).fill(PROFILE.phone);
    await inputs.nth(2).fill(PROFILE.email);
    await inputs.nth(3).fill(PROFILE.address);
    await panel.locator("select").selectOption(PROFILE.contact);
    await panel.getByRole("button", { name: "Save" }).click();
    await tickAndStart(page);
    await waitUntilFilled(page);
    expect(await fieldValues(page)).toEqual(expectedValues(report));
    await context.close();
  });
```

### Тест (src/install.test.ts), проверка адресов обновления

```
    for (const key of ["@updateURL", "@downloadURL"]) {
      expect(file).toMatch(new RegExp(`^// ${key}\\s+https://\\S+${SCRIPT_PATH}$`, "m"));
    }
```

### docs/architecture.md, п.42

```
из `STREETBUDDY_PROFILE`, если она есть на странице)
```

### docs/decisions.md, п.82

```
82. Панель личных данных тоже форма: ее сохранение не должно стирать данные ссылки.
```

### docs/decisions.md, п.90

```
90. Юзерскрипт, в отличие от закладки, не загружает файл при каждом запуске: приложение обновляет его только при более высоком `@version`, поэтому адрес обновления в шапке обязателен. Адрес записан целиком, потому что шапку читает приложение, а не Worker.
```

### docs/pending.md, п.14

```
14. Кнопка сброса личных данных в юзерскрипте: сейчас данные из панели стираются только в хранилище расширения или удалением и повторной установкой скрипта.
```
