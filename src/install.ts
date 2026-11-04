// Installation guide page and the userscript file, both served by the Worker.
import userscript from "../userscript/streetbuddy.user.js";

export const INSTALL_PATH = "/install";
export const SCRIPT_PATH = "/streetbuddy.user.js";

const FIREFOX_URL = "https://play.google.com/store/apps/details?id=org.mozilla.firefox";
const VIOLENTMONKEY_URL = "https://addons.mozilla.org/firefox/addon/violentmonkey/";

// The page builds the bookmarklet in the browser and does not send the personal data typed in to
// this Worker. The bookmarklet holds the data and loads the form-filling script from this same Worker
// each time it is run, so it stays short and needs no rebuilding when the script is updated.
// A bookmarklet can only be added by hand in Chrome on Android, so the page gives the code to
// copy and also as a link (to copy with a long press, or to drag to the bookmarks bar on a
// computer). The data is checked by the same rules as validateProfile in the userscript: the
// script stays silent on data it does not accept.
const PAGE_SCRIPT = `(function () {
  "use strict";
  var SCRIPT_URL = location.origin + "${SCRIPT_PATH}";
  var CONTACT_METHODS = ["Email", "Phone Call", "Text Message"];

  // A row of choice buttons: the pressed one shows its sections (data-<key>-section) and hides the others.
  function select(button, key) {
    var group = button.parentNode.querySelectorAll("button");
    for (var i = 0; i < group.length; i++) group[i].setAttribute("aria-pressed", String(group[i] === button));
    var sections = document.querySelectorAll("[data-" + key + "-section]");
    for (var j = 0; j < sections.length; j++) {
      sections[j].hidden = sections[j].getAttribute("data-" + key + "-section") !== button.getAttribute("data-" + key);
    }
  }
  function bindChoice(key) {
    var buttons = document.querySelectorAll("[data-" + key + "]");
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].addEventListener("click", function (event) { select(event.currentTarget, key); });
    }
  }
  bindChoice("browser");
  bindChoice("variant");

  function validProfile(form) {
    // form.elements, not the form itself: form.name is the name of the form.
    var fields = form.elements;
    var profile = {
      name: fields.name.value.trim(),
      phone: fields.phone.value.trim(),
      email: fields.email.value.trim(),
      address: fields.address.value.trim(),
      contact: fields.contact.value
    };
    if (!profile.name || !profile.phone || !profile.address) return null;
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(profile.email)) return null;
    if (CONTACT_METHODS.indexOf(profile.contact) === -1) return null;
    return profile;
  }

  var form = document.getElementById("bookmark-form");
  var error = document.getElementById("bookmark-error");
  var created = document.getElementById("bookmark-created");
  var ready = document.getElementById("bookmark-ready");
  var link = document.getElementById("bookmark-link");
  var copied = document.getElementById("bookmark-copied");
  var copyFailed = document.getElementById("bookmark-copy-failed");
  var bookmark = "";

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var profile = validProfile(form);
    error.hidden = profile !== null;
    created.hidden = profile === null;
    ready.hidden = profile === null;
    copied.hidden = true;
    copyFailed.hidden = true;
    if (!profile) return;
    // void: a bookmarklet that returns a value replaces the page with that value.
    bookmark = "javascript:" + encodeURIComponent(
      "void function () {globalThis.STREETBUDDY_PROFILE = " + JSON.stringify(profile) + ";" +
      "var s = document.createElement('script'); s.src = " + JSON.stringify(SCRIPT_URL) + ";" +
      "document.head.appendChild(s);}();"
    );
    link.href = bookmark;
  });

  // A plain tap on the bookmarklet link would only run it on this page, where it does nothing.
  link.addEventListener("click", function (event) { event.preventDefault(); });

  document.getElementById("bookmark-copy").addEventListener("click", function () {
    copied.hidden = true;
    copyFailed.hidden = true;
    navigator.clipboard.writeText(bookmark).then(
      function () { copied.hidden = false; },
      function () { copyFailed.hidden = false; }
    );
  });
})();`;

// Static page: no user input is ever put into it on the server, so nothing here is escaped.
const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Руководство по установке StreetBuddy</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; font: 17px/1.5 system-ui, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.2rem; margin-top: 2rem; }
  h3 { font-size: 1.05rem; margin-top: 1.5rem; }
  a { overflow-wrap: anywhere; }
  .choice button { font: inherit; padding: 8px 16px; margin-right: 8px; }
  .choice button[aria-pressed="true"] { font-weight: bold; }
  .install { display: inline-block; padding: 10px 20px; border: 2px solid; border-radius: 6px; font: inherit; font-weight: bold; text-decoration: none; }
  /* The bookmark is a link, which would otherwise be blue unlike the real buttons. */
  #bookmark-link { color: ButtonText; background-color: ButtonFace; }
  .ok { color: #1a7f37; }
  @media (prefers-color-scheme: dark) { .ok { color: #3fb950; } }
  summary { cursor: pointer; font-weight: bold; margin: 1.5rem 0 0.75rem; }
  label { display: block; margin: 12px 0; }
  input, select { display: block; width: 100%; box-sizing: border-box; font: inherit; padding: 6px; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<main>
<h1>Руководство по установке StreetBuddy</h1>
<p>StreetBuddy - Telegram-бот для репортов о неправильной парковке на портале Traffic Watch Online Reporting.</p>
<p>Вы отправляете репорт через браузер на вашем телефоне.</p>
<p>Бот помогает вам подготовить текст репорта.</p>
<p>Вы присылаете личным сообщением боту локейшн и фото неправильно запаркованной машины, а бот создает описание нарушения и готовит для вас текст полей репорта.</p>
<p>Личные данные отправителя, необходимые для репорта (ваши имя, фамилия, номер телефона, email и адрес), бот у себя не хранит, поэтому их нужно заранее сохранить на вашем телефоне.</p>
<p>Чтобы браузер мог взять подготовленное ботом описание нарушения и добавить к нему личные данные отправителя, нужно настроить браузер на телефоне по инструкции ниже.</p>

<h2>Какой у вас телефон?</h2>
<p class="choice"><button type="button" aria-pressed="true">Android</button><button type="button" disabled>iPhone</button></p>

<h2>Какой браузер вы будете использовать для репорта?</h2>
<p class="choice"><button type="button" aria-pressed="true" data-browser="firefox">Firefox</button><button type="button" aria-pressed="false" data-browser="chrome">Chrome</button></p>

<section data-browser-section="firefox">
<p>Вам потребуется:</p>
<ul>
<li>Установить браузер Firefox</li>
<li>Установить в Firefox расширение Violentmonkey</li>
<li>Установить в Violentmonkey скрипт, который будет хранить ваши личные данные и добавлять их в форму репорта.</li>
<li>Составить тестовый репорт.</li>
</ul>

<h3>1. Установите Firefox</h3>
<p>Установите Firefox из Google Play: <a href="${FIREFOX_URL}">${FIREFOX_URL}</a></p>
<p>Откройте это руководство в Firefox: нажмите «⋮» вверху справа и «Открыть в браузере». Если Telegram предлагает только Chrome, сделайте Firefox браузером по умолчанию (настройки телефона, «Приложения», «Приложения по умолчанию», «Браузер», Firefox) или нажмите в этом же меню «Copy Link», откройте Firefox и вставьте адрес в адресную строку.</p>

<h3>2. Установите расширение Violentmonkey</h3>
<p>Нажмите на ссылку: <a href="${VIOLENTMONKEY_URL}">${VIOLENTMONKEY_URL}</a></p>
<p>Нажмите «Добавить в Firefox», затем «Добавить» в окне подтверждения.</p>
<p>Если Firefox спросит о приватных вкладках, нажмите «ОК».</p>
<p>Проверьте, установилось ли расширение: «⋮» вверху справа, «Дополнения». Violentmonkey должен быть в списке включенных.</p>
<p>Вернитесь кнопкой «Назад» на страницу руководства.</p>

<h3>3. Установите скрипт</h3>
<p>Нажмите кнопку «Установить скрипт»:</p>
<p><a class="install" href="${SCRIPT_PATH}">Установить скрипт</a></p>
<p>В окне Violentmonkey нажмите «Подтвердить установку».</p>
<p>Установка скрипта закончена, закройте вкладку и вернитесь в Telegram.</p>

<h3>4. Составьте тестовый репорт</h3>
<p>В Telegram отправьте боту StreetBuddy местоположение. Для тестового репорта выберите место в районе, где работает бот, иначе бот ответит, что в этом районе не работает.</p>
<p>В чате с ботом нажмите скрепку справа в строке ввода, «Location», передвиньте указатель на нужное место и нажмите «Send selected location».</p>
<p>Бот покажет найденный адрес: нажмите «Confirm».</p>
<p>Затем бот запросит фото машины. Для тестового репорта вы можете прислать любое фото, например, своей машины.</p>
<p>Далее бот запустит процесс подготовки репорта, пройдите его по шагам.</p>
<p>На последнем шаге бот покажет готовое описание. Нажмите кнопку «Open form» под описанием, затем «⋮» вверху справа и «Открыть в браузере» (форма должна открыться в Firefox, см. шаг 1).</p>
<p>Когда форма откроется в первый раз, вверху страницы появится окно скрипта: введите имя и фамилию, телефон, email, адрес и способ связи с вами, нажмите «Save». Эти данные вводятся один раз, они хранятся в расширении Violentmonkey в Firefox. Чтобы их изменить, удалите скрипт StreetBuddy в Violentmonkey и установите его заново кнопкой «Установить скрипт» (шаг 3): при следующем открытии формы скрипт спросит данные снова.</p>
<p>Затем поставьте две галочки на странице Traffic Watch Online Reporting: об отсутствии emergency и о явке в суд, нажмите «Click Here to Start» и проверьте, как заполнились поля формы. Проходить капчу и нажимать «Submit Report» для тестового репорта не надо.</p>
<p>На этом установка закончена, вы можете пользоваться ботом.</p>
<p>Вернитесь в Telegram и под описанием тестового репорта нажмите «Cancel»: бот удалит это сообщение вместе с кнопками. После настоящего репорта нажимайте «Done»: бот уберет кнопки и допишет, когда репорт был отправлен.</p>
</section>

<section data-browser-section="chrome" hidden>
<p>Chrome на телефоне не поддерживает расширения, поэтому ваши личные данные будут храниться в закладке Chrome: при запуске закладка загружает с сайта StreetBuddy скрипт, который добавляет эти данные в форму репорта. Для запуска нужен интернет.</p>
<p>Вам потребуется:</p>
<ul>
<li>Ввести ваши личные данные на этой странице и создать закладку.</li>
<li>Добавить закладку в Chrome.</li>
<li>Составить тестовый репорт.</li>
</ul>

<h3>1. Откройте руководство в Chrome</h3>
<p>Нажмите «⋮» вверху справа и «Открыть в браузере». Если руководство открылось не в Chrome, сделайте Chrome браузером по умолчанию (настройки телефона, «Приложения», «Приложения по умолчанию», «Браузер», Chrome) или нажмите в этом же меню «Copy Link», откройте Chrome и вставьте адрес в адресную строку.</p>

<h3>2. Создайте закладку</h3>
<p>Введите ваши данные. Они нужны только для закладки: эта страница собирает закладку прямо в браузере и никуда данные не отправляет.</p>
<form id="bookmark-form" novalidate>
<label>Имя и фамилия (First Name and Last Name)<input name="name" type="text"></label>
<label>Телефон (Phone)<input name="phone" type="tel"></label>
<label>Email<input name="email" type="email"></label>
<label>Адрес (Address)<input name="address" type="text"></label>
<label>Как с вами связаться (How you wish to be contacted)<select name="contact"><option value="" selected></option><option>Email</option><option>Phone Call</option><option>Text Message</option></select></label>
<p><button class="install" type="submit">Создать закладку</button></p>
<p id="bookmark-created" class="ok" role="status" hidden>Закладка создана.</p>
<p id="bookmark-error" role="alert" hidden>Заполните все поля. Email должен быть в виде name@example.com.</p>
</form>

<div id="bookmark-ready" hidden>
<h3>3. Добавьте закладку в Chrome</h3>
<p>Нажмите кнопку «Скопировать закладку»:</p>
<p><button class="install" type="button" id="bookmark-copy">Скопировать закладку</button></p>
<p id="bookmark-copied" class="ok" role="status" hidden>Закладка скопирована.</p>
<p id="bookmark-copy-failed" role="alert" hidden>Скопировать не получилось. Попробуйте «Другие варианты добавления закладки» ниже.</p>
<p>Добавьте эту страницу в закладки: нажмите «⋮» вверху справа и значок звезды ☆. Звезда станет закрашенной ★: нажмите «⋮» и ее еще раз, откроется окно закладки.</p>
<p>В окне закладки в поле названия сотрите название и напишите qwerty. В поле адреса сотрите адрес этой страницы и вставьте скопированное (долгое нажатие на поле, «Вставить»). Вернитесь кнопкой «Назад»: закладка сохранится.</p>
<details>
<summary>Другие варианты добавления закладки</summary>
<p class="choice"><button type="button" aria-pressed="true" data-variant="phone">Продолжить с телефона</button><button type="button" aria-pressed="false" data-variant="computer">Настроить с компьютера</button></p>
<div data-variant-section="phone">
<p>Если кнопка «Скопировать закладку» не сработала, долго нажмите на кнопку qwerty и выберите «Копировать адрес ссылки», затем добавьте закладку так же, как описано выше.</p>
</div>
<div data-variant-section="computer" hidden>
<p>Закладку можно добавить и с компьютера, если Chrome на компьютере и на телефоне подключен к одному аккаунту Google и в обоих включена синхронизация закладок (на телефоне: «⋮», «Настройки», ваш аккаунт, «Синхронизация», «Закладки»).</p>
<p>Откройте это руководство в Chrome на компьютере, выберите Chrome, введите данные, нажмите «Создать закладку» и перетащите мышкой кнопку qwerty на панель закладок (если панели не видно, нажмите Ctrl+Shift+B, на Mac Cmd+Shift+B). Через несколько минут закладка появится в Chrome на телефоне.</p>
<p>Закладка с вашими данными будет храниться в вашем аккаунте Google.</p>
</div>
<p><a class="install" id="bookmark-link" href="#">qwerty</a></p>
</details>
<p>Не открывайте закладку qwerty из списка закладок: так она откроется на пустой странице и не сработает. Ее запускают на форме репорта, как описано в шаге 4.</p>
<p>Закладка содержит ваши личные данные, не пересылайте ее другим. Чтобы изменить данные, создайте закладку на этой странице заново и вставьте ее в закладку qwerty вместо прежней. Скрипт обновляется сам, ради этого закладку пересоздавать не нужно.</p>

</div>

<h3>4. Составьте тестовый репорт</h3>
<p>В Telegram отправьте боту StreetBuddy местоположение. Для тестового репорта выберите место в районе, где работает бот, иначе бот ответит, что в этом районе не работает.</p>
<p>В чате с ботом нажмите скрепку справа в строке ввода, «Location», передвиньте указатель на нужное место и нажмите «Send selected location».</p>
<p>Бот покажет найденный адрес: нажмите «Confirm».</p>
<p>Затем бот запросит фото машины. Для тестового репорта вы можете прислать любое фото, например, своей машины.</p>
<p>Далее бот запустит процесс подготовки репорта, пройдите его по шагам.</p>
<p>На последнем шаге бот покажет готовое описание. Нажмите кнопку «Open form» под описанием, затем «⋮» вверху справа и «Открыть в браузере» (форма должна открыться в Chrome, см. шаг 1).</p>
<p>Когда форма откроется, нажмите на адресную строку вверху, наберите qwerty и выберите в подсказках закладку qwerty (со значком звезды).</p>
<p>Затем поставьте две галочки на странице Traffic Watch Online Reporting: об отсутствии emergency и о явке в суд, нажмите «Click Here to Start» и проверьте, как заполнились поля формы. Проходить капчу и нажимать «Submit Report» для тестового репорта не надо.</p>
<p>На этом установка закончена, вы можете пользоваться ботом. Для каждого репорта запускайте закладку qwerty так же: после того как форма откроется.</p>
<p>Вернитесь в Telegram и под описанием тестового репорта нажмите «Cancel»: бот удалит это сообщение вместе с кнопками. После настоящего репорта нажимайте «Done»: бот уберет кнопки и допишет, когда репорт был отправлен.</p>
</section>

<p>Бот не получает и не хранит ваши имя, фамилию, телефон, email и адрес.</p>
<p>Если вы бросили репорт на середине, бот удалит его данные из своей базы через 24 часа. Текст готового описания бот хранит, пока вы не нажали «Cancel» или «Done», но не дольше 48 часов.</p>
</main>
<script>
${PAGE_SCRIPT}
</script>
</body>
</html>
`;

export function installPage(): Response {
  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// Violentmonkey offers to install a script when it is opened from an address ending in .user.js.
export function userscriptFile(): Response {
  return new Response(userscript, { headers: { "content-type": "text/javascript; charset=utf-8" } });
}
