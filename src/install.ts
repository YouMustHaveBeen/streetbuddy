// Installation guide page and the userscript file, both served by the Worker.
import userscript from "../userscript/streetbuddy.user.js";

export const INSTALL_PATH = "/install";
export const SCRIPT_PATH = "/streetbuddy.user.js";

export function htmlResponse(page: string): Response {
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}

// Shared with the manual page. A row of choice buttons: the pressed one shows its sections
// (data-<key>-section) and hides the others.
export const CHOICE_SCRIPT = `function select(button, key) {
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
  }`;

// Shared with the manual page.
export const BASE_STYLE = `  :root { color-scheme: light dark; }
  body { margin: 0; font: 17px/1.5 system-ui, sans-serif; }
  main { max-width: 40rem; margin: 0 auto; padding: 16px; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.2rem; margin-top: 2rem; }
  h3 { font-size: 1.05rem; margin-top: 1.5rem; }
  a { overflow-wrap: anywhere; }
  .choice button { font: inherit; padding: 8px 16px; margin-right: 8px; }
  .choice button[aria-pressed="true"] { font-weight: bold; }
  [hidden] { display: none !important; }`;

const PAGE_SCRIPT = `(function () {
  "use strict";
  var SCRIPT_URL = location.origin + "${SCRIPT_PATH}";
  var CONTACT_METHODS = ["Email", "Phone Call", "Text Message"];

  ${CHOICE_SCRIPT}
  bindChoice("variant");

  // The phone decides which blocks (data-for) are shown.
  var os = "android";

  function showBlocks() {
    var mode = os === "android" ? "android" : "iphone-bookmark";
    var blocks = document.querySelectorAll("[data-for]");
    for (var i = 0; i < blocks.length; i++) {
      blocks[i].hidden = blocks[i].getAttribute("data-for").split(" ").indexOf(mode) === -1;
    }
  }

  function bindBlocks(key, onChoice) {
    var buttons = document.querySelectorAll("[data-" + key + "]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener("click", function (event) {
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].setAttribute("aria-pressed", String(buttons[j] === event.currentTarget));
        }
        onChoice(event.currentTarget.getAttribute("data-" + key));
        showBlocks();
      });
    }
  }

  bindBlocks("os", function (value) { os = value; });

  function validProfile(form) {
    // Reads the fields through form.elements.
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
    // The bookmarklet holds the data and the address of the script.
    bookmark = "javascript:" + encodeURIComponent(
      "void function () {globalThis.STREETBUDDY_PROFILE = " + JSON.stringify(profile) + ";" +
      "var s = document.createElement('script'); s.src = " + JSON.stringify(SCRIPT_URL) + ";" +
      "document.head.appendChild(s);}();"
    );
    link.href = bookmark;
  });

  // A plain tap on the bookmarklet link does nothing.
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

// Static page.
const PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreetBuddy</title>
<style>
${BASE_STYLE}
  .install { display: inline-block; padding: 10px 20px; border: 2px solid; border-radius: 6px; font: inherit; font-weight: bold; text-decoration: none; }
  /* Colors the bookmark link like the real buttons. */
  #bookmark-link { color: ButtonText; background-color: ButtonFace; }
  .ok { color: #1a7f37; }
  @media (prefers-color-scheme: dark) { .ok { color: #3fb950; } }
  summary { cursor: pointer; font-weight: bold; margin: 1.5rem 0 0.75rem; }
  label { display: block; margin: 12px 0; }
  input, select { display: block; width: 100%; box-sizing: border-box; font: inherit; padding: 6px; }
</style>
</head>
<body>
<main>
<h1>StreetBuddy<br>Руководство по установке</h1>
<p>Чтобы отправить репорт о неправильной парковке на портале Traffic Watch Online Reporting, нужно заполнить 11 полей:</p>
<p>6 полей, описывающих нарушение:</p>
<ol>
<li>Адрес,</li>
<li>Каунти,</li>
<li>Тип нарушения,</li>
<li>Ваша роль,</li>
<li>Описание нарушения, включая номер автомобиля,</li>
<li>Дата нарушения,</li>
</ol>
<p>и 5 полей, содержащих вашу личную информацию:</p>
<ol start="7">
<li>Имя и Фамилия,</li>
<li>Телефон,</li>
<li>Емейл,</li>
<li>Адрес,</li>
<li>Как с вами связаться.</li>
</ol>
<p>Бот StreetBuddy помогает вам ускорить этот процесс.</p>
<p>Перед тем, как использовать бота, вы один раз вводите и сохраняете свои личные данные, необходимые для репорта (пункты 7-11), на вашем телефоне. Они никуда не передаются, а сохраняются в закладке в браузере и используются потом в каждом репорте. Бот ваши личные данные не читает и не хранит.</p>
<p>Когда вы хотите отправить репорт, вы присылаете боту локейшн и фото машины, бот предлагает вам варианты текста на выбор, заполняет поля репорта, описывающие нарушение (пункты 1-6) и выдает вам ссылку для браузера.</p>
<p>Вы открываете эту ссылку в Google Chrome, если у вас андроид, или в Safari, если у вас айфон, затем там же открываете закладку с личными данными, и в итоге получаете страницу, где заполнены все 11 полей.</p>
<p>Готовый репорт вы отправляете сами, нажав на кнопку “Submit Report” в браузере на вашем телефоне.</p>
<p>Почему бот работает именно так, через ссылки и закладки? Потому что это дает возможность не устанавливать на телефон никаких дополнительных приложений и не нарушать правила использования сайта Гарды.</p>
<p>Чтобы использовать бота, нужно настроить браузер на телефоне по инструкции ниже.</p>

<h2>Какой у вас телефон?</h2>
<p class="choice"><button type="button" aria-pressed="true" data-os="android">Android</button><button type="button" aria-pressed="false" data-os="iphone">iPhone</button></p>

<section>
<div data-for="android">
<p>Ваши личные данные будут храниться в закладке Chrome: при запуске закладка загружает с сайта StreetBuddy скрипт, который добавляет эти данные в форму репорта. Закладку нужно запускать на каждом репорте. Для запуска нужен интернет.</p>
<p>Вам потребуется:</p>
<ul>
<li>Ввести ваши личные данные на этой странице и создать закладку.</li>
<li>Добавить закладку в Chrome.</li>
<li>Составить тестовый репорт.</li>
</ul>

<h3>1. Откройте руководство в Chrome</h3>
<p>Нажмите «⋮» вверху справа и «Open in browser». Если руководство открылось не в Chrome, сделайте Chrome браузером по умолчанию (настройки телефона, «Apps», «Default apps», «Browser app», Chrome) или нажмите в этом же меню «Copy Link», откройте Chrome и вставьте адрес в адресную строку.</p>
</div>

<div data-for="iphone-bookmark" hidden>
<p>Ваши личные данные будут храниться в закладке Safari: при запуске закладка загружает с сайта StreetBuddy скрипт, который добавляет эти данные в форму репорта. Закладку нужно запускать на каждом репорте. Для запуска нужен интернет.</p>
<p>Вам потребуется:</p>
<ul>
<li>Ввести ваши личные данные на этой странице и создать закладку.</li>
<li>Добавить закладку в Safari.</li>
<li>Составить тестовый репорт.</li>
</ul>

<h3>1. Откройте руководство в Safari</h3>
<p>Если это руководство открылось внутри Telegram, нажмите «⋯» вверху и «Open in Safari».</p>
<p>Это необязательно, но можно сделать так, чтобы страницы из Telegram сразу открывались в Safari: в Telegram откройте «Settings», «Data and Storage», «Open Links in» и выберите Safari. Настройка действует на все страницы, которые вы открываете из Telegram, а не только на бота.</p>
</div>

<div data-for="android iphone-bookmark">
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
<h3 data-for="android">3. Добавьте закладку в Chrome</h3>
<h3 data-for="iphone-bookmark" hidden>3. Добавьте закладку в Safari</h3>
<p>Нажмите кнопку «Скопировать закладку»:</p>
<p><button class="install" type="button" id="bookmark-copy">Скопировать закладку</button></p>
<p id="bookmark-copied" class="ok" role="status" hidden>Закладка скопирована.</p>
<p id="bookmark-copy-failed" role="alert" hidden>Скопировать не получилось. Попробуйте «Другие варианты добавления закладки» ниже.</p>
<div data-for="android">
<p>Добавьте эту страницу в закладки: нажмите «⋮» вверху справа и значок звезды ☆. Звезда станет закрашенной ★: нажмите «⋮» и ее еще раз, откроется окно закладки.</p>
<p>В окне закладки в поле названия сотрите название и напишите qqqwww. В поле адреса сотрите адрес этой страницы и вставьте скопированное (долгое нажатие на поле, «Paste»). Вернитесь кнопкой «Назад»: закладка сохранится.</p>
</div>
<div data-for="iphone-bookmark" hidden>
<p>Добавьте эту страницу в закладки: нажмите кнопку «Share» (квадрат со стрелкой, на новых версиях iOS она в меню «⋯»), затем «Add Bookmark». Сотрите название, напишите qqqwww и нажмите «Save».</p>
<p>Нажмите «⋯» внизу и «Bookmarks», затем «Edit» и выберите qqqwww. В поле адреса сотрите адрес этой страницы и вставьте скопированное (долгое нажатие на поле, «Paste»). Нажмите «Done».</p>
</div>
<details>
<summary>Другие варианты добавления закладки</summary>
<div data-for="android">
<p class="choice"><button type="button" aria-pressed="true" data-variant="phone">Продолжить с телефона</button><button type="button" aria-pressed="false" data-variant="computer">Настроить с компьютера</button></p>
<div data-variant-section="phone">
<p>Если кнопка «Скопировать закладку» не сработала, долго нажмите на кнопку qqqwww и выберите «Copy link address», затем добавьте закладку так же, как описано выше.</p>
</div>
<div data-variant-section="computer" hidden>
<p>Закладку можно добавить и с компьютера, если Chrome на компьютере и на телефоне подключен к одному аккаунту Google и в обоих включена синхронизация закладок (на телефоне: «⋮», «Settings», ваш аккаунт, «Sync», «Bookmarks»).</p>
<p>Откройте это руководство в Chrome на компьютере, выберите Chrome, введите данные, нажмите «Создать закладку» и перетащите мышкой кнопку qqqwww на панель закладок (если панели не видно, нажмите Ctrl+Shift+B, на Mac Cmd+Shift+B). Через несколько минут закладка появится в Chrome на телефоне.</p>
<p>Закладка с вашими данными будет храниться в вашем аккаунте Google.</p>
</div>
</div>
<p data-for="iphone-bookmark" hidden>Если кнопка «Скопировать закладку» не сработала, долго нажмите на кнопку qqqwww и выберите «Copy Link», затем добавьте закладку так же, как описано выше.</p>
<p><a class="install" id="bookmark-link" href="#">qqqwww</a></p>
</details>
<p data-for="android">Не открывайте закладку qqqwww из списка закладок: так она откроется на пустой странице и не сработает. Ее запускают на форме репорта, как описано в шаге 4.</p>
<p data-for="iphone-bookmark" hidden>Запускайте закладку qqqwww только на открытой форме репорта, как описано в шаге 4.</p>
<p>Закладка содержит ваши личные данные, не пересылайте ее другим. Чтобы изменить данные, создайте закладку на этой странице заново и вставьте ее в закладку qqqwww вместо прежней. Скрипт обновляется сам, ради этого закладку пересоздавать не нужно.</p>

</div>
</div>

<h3>4. Составьте тестовый репорт</h3>
<p>В Telegram отправьте боту StreetBuddy местоположение. Для тестового репорта выберите место в районе, где работает бот, иначе бот ответит, что в этом районе не работает.</p>
<p data-for="android">В чате с ботом нажмите скрепку справа в строке ввода, «Location», передвиньте указатель на нужное место и нажмите «Send selected location».</p>
<p data-for="iphone-bookmark" hidden>В чате с ботом нажмите скрепку слева от строки ввода, «Location», передвиньте указатель на нужное место и нажмите «Send selected location».</p>
<p>Бот напишет «Choose the address» и покажет адреса рядом с выбранным местом: нажмите подходящий. Если подходящего нет, нажмите «Other address» и напишите адрес сообщением.</p>
<p>Затем бот запросит фото машины. Для тестового репорта вы можете прислать любое фото, например, своей машины.</p>
<p>Далее бот запустит процесс подготовки репорта, пройдите его по шагам.</p>
<div data-for="android">
<p>Бот покажет готовое описание и спросит «Is everything correct?»: нажмите «Yes, it’s correct». Если бот еще не знает ваш телефон (в первый раз), он спросит «Your phone?»: нажмите «Android». Затем нажмите кнопку «Open report» под описанием, затем «⋮» вверху справа и «Open in browser» (форма должна открыться в Chrome, см. шаг 1).</p>
<p>Когда форма откроется, нажмите на адресную строку вверху, наберите qqqwww и выберите в подсказках закладку qqqwww (со значком звезды).</p>
</div>
<p data-for="iphone-bookmark" hidden>Бот покажет готовое описание и спросит «Is everything correct?»: нажмите «Yes, it’s correct». Если бот еще не знает ваш телефон (в первый раз), он спросит «Your phone?»: нажмите «iPhone».</p>
<p data-for="iphone-bookmark" hidden>Нажмите кнопку «Open report» под описанием. Если форма открылась внутри Telegram, нажмите «⋯» вверху и «Open in Safari».</p>
<p data-for="iphone-bookmark" hidden>Когда форма откроется, нажмите «⋯» внизу, «Bookmarks» и qqqwww.</p>
<p>Затем поставьте две галочки на странице Traffic Watch Online Reporting: об отсутствии emergency и о явке в суд, нажмите «Click Here to Start» и проверьте, как заполнились поля формы. Проходить капчу и нажимать «Submit Report» для тестового репорта не надо.</p>
<p data-for="android iphone-bookmark">На этом установка закончена, вы можете пользоваться ботом. Для каждого репорта запускайте закладку qqqwww так же: после того как форма откроется.</p>
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
  return htmlResponse(PAGE);
}

export function userscriptFile(): Response {
  return new Response(userscript, { headers: { "content-type": "text/javascript; charset=utf-8" } });
}
