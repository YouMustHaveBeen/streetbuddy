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
  .choice button[aria-pressed="true"] { font-weight: bold; background: #b8e08a; color: #000; }
  [hidden] { display: none !important; }`;

const PAGE_SCRIPT = `(function () {
  "use strict";
  var SCRIPT_URL = location.origin + "${SCRIPT_PATH}";
  var CONTACT_METHODS = ["Email", "Phone Call", "Text Message"];

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
  var prepared = document.getElementById("bookmark-prepared");
  var copyFailed = document.getElementById("bookmark-copy-failed");
  var code = document.getElementById("bookmark-code");

  function showCode(text) {
    copyFailed.hidden = false;
    code.value = text;
    code.hidden = false;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var profile = validProfile(form);
    error.hidden = profile !== null;
    prepared.hidden = true;
    copyFailed.hidden = true;
    code.hidden = true;
    if (!profile) return;
    // The bookmarklet holds the data and the address of the script.
    var bookmark = "javascript:" + encodeURIComponent(
      "void function () {globalThis.STREETBUDDY_PROFILE = " + JSON.stringify(profile) + ";" +
      "var s = document.createElement('script'); s.src = " + JSON.stringify(SCRIPT_URL) + ";" +
      "document.head.appendChild(s);}();"
    );
    if (!navigator.clipboard) {
      showCode(bookmark);
      return;
    }
    navigator.clipboard.writeText(bookmark).then(
      function () { prepared.hidden = false; },
      function () { showCode(bookmark); }
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
  .ok { color: #1a7f37; }
  .warn { color: #c62828; }
  @media (prefers-color-scheme: dark) { .ok { color: #3fb950; } .warn { color: #ff6b6b; } }
  label { display: block; margin: 12px 0; }
  input, select, textarea { display: block; width: 100%; box-sizing: border-box; font: inherit; padding: 6px; }
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
<p>Вам потребуется:</p>
<ul>
<li>открыть браузер Chrome,</li>
<li>ввести личные данные,</li>
<li>подготовить закладку,</li>
<li>добавить закладку в Chrome,</li>
<li>составить и отменить тестовый репорт</li>
</ul>

<h3>1. Откройте это руководство в Chrome</h3>
<p>Если вы читаете это руководство с компьютера, время переключиться на телефон: бот работает и настраивается с телефона.</p>
<p>По умолчанию телеграм открывает ссылки на телефоне в своем встроенном браузере, а вам нужен браузер Chrome. Проведите по экрану телефона вниз, чтобы сверху открылась панель, нажмите в ней «⋮» справа и выберите «Open in Chrome browser», руководство откроется в Chrome.</p>
</div>

<div data-for="iphone-bookmark" hidden>
<p>Вам потребуется:</p>
<ul>
<li>открыть браузер Safari,</li>
<li>ввести личные данные,</li>
<li>подготовить закладку,</li>
<li>добавить закладку в Safari,</li>
<li>составить и отменить тестовый репорт</li>
</ul>

<h3>1. Откройте это руководство в Safari</h3>
<p>Если вы читаете это руководство с компьютера, время переключиться на телефон: бот работает и настраивается с телефона.</p>
<p>По умолчанию телеграм открывает ссылки на телефоне в своем встроенном браузере, а вам нужен браузер Safari. Проведите по экрану телефона вниз, чтобы сверху открылась панель, нажмите в ней «⋯» и выберите «Open in Safari», руководство откроется в Safari.</p>
</div>

<form id="bookmark-form" novalidate>
<h3>2. Введите личные данные</h3>
<p>Чтобы создать закладку с вашими данными, боту нужно собрать данные вместе. Бот никуда их не отправляет, они остаются на этой странице в вашем телефоне.</p>
<p>Введите ваши данные в поля ниже.</p>
<label>Имя и фамилия (First Name and Last Name)<input name="name" type="text"></label>
<label>Телефон (Phone)<input name="phone" type="tel"></label>
<label>Email<input name="email" type="email"></label>
<label>Адрес (Address)<input name="address" type="text"></label>
<label>Как с вами связаться (How you wish to be contacted)<select name="contact"><option value="" selected></option><option>Email</option><option>Phone Call</option><option>Text Message</option></select></label>

<h3>3. Подготовьте закладку</h3>
<p>Кнопка «Подготовить закладку» проверяет введенные данные, собирает из них код и кладет этот код в буфер обмена, чтобы вы могли вставить его в закладку.</p>
<p>Нажмите кнопку «Подготовить закладку».</p>
<p><button class="install" type="submit">Подготовить закладку</button></p>
<p id="bookmark-prepared" class="ok" role="status" hidden>Закладка подготовлена</p>
<p id="bookmark-error" role="alert" hidden>Заполните все поля. Email должен быть в виде name@example.com.</p>
<p id="bookmark-copy-failed" class="warn" role="alert" hidden>Не получилось скопировать код автоматически. Скопируйте его из поля ниже: долгое нажатие на поле, «Select all», «Copy»</p>
<textarea id="bookmark-code" aria-label="Код закладки" rows="6" readonly hidden></textarea>
</form>

<div data-for="android">
<h3>4. Добавьте закладку в Chrome</h3>
<p>Добавьте страницу руководства, которую вы сейчас читаете, в закладки.</p>
<p>Для этого проведите по экрану телефона вниз, чтобы сверху открылась панель, нажмите в ней «⋮» справа, затем ☆ Bookmarks.</p>
<p>В Chrome будет добавлена закладка с именем StreetBuddy и ссылкой на это руководство.</p>
<p>Далее нужно изменить название закладки и ее текст.</p>
<p>Снова нажмите справа сверху «⋮», затем ★ Bookmarks, найдите в списке закладок StreetBuddy.</p>
<p>Нажмите справа от названия закладки «⋮», затем Edit.</p>
<p>В поле названия закладки сотрите StreetBuddy и напишите новое название: qqqwww. Можно использовать для названия любой другой удобный вам вариант, но учтите, что название должно быть максимально редким, иначе Chrome при поиске закладки будет предлагать другие варианты.</p>
<p>В поле адреса закладки сотрите адрес руководства и вставьте находящийся в буфере код: долгое нажатие на старый адрес, «Paste».</p>
<p>Вернитесь кнопкой «Назад» (треугольник): закладка сохранится в новом виде, настройка браузера завершена.</p>
<p>Закладка содержит ваши личные данные, никому ее не пересылайте.</p>
<p>Не открывайте закладку qqqwww из списка закладок: так она откроется на пустой странице и не сработает. Ее запускают на форме репорта.</p>
</div>

<div data-for="iphone-bookmark" hidden>
<h3>4. Добавьте закладку в Safari</h3>
<p>Добавьте страницу руководства, которую вы сейчас читаете, в закладки.</p>
<p>Для этого проведите по экрану телефона вниз, чтобы снизу открылась панель, нажмите «Share» (квадрат со стрелкой, на новых версиях iOS он в меню «⋯»), затем «Add Bookmark». Сотрите название, напишите qqqwww и нажмите «Save».</p>
<p>Нажмите «⋯» внизу и «Bookmarks», затем «Edit» и выберите qqqwww. В поле адреса сотрите адрес руководства и вставьте код из буфера (долгое нажатие на поле, «Paste»). Нажмите «Done».</p>
<p>Закладка содержит ваши личные данные, никому ее не пересылайте.</p>
<p>Запускайте закладку qqqwww только на открытой форме репорта.</p>
</div>

<h3>5. Составьте и отмените тестовый репорт</h3>
<p class="warn">ВНИМАНИЕ: не нажимайте “Submit Report” для тестового репорта.</p>
<p>В Telegram отправьте боту StreetBuddy местоположение.</p>
<p>Для тестового репорта выберите место в районе, где работает бот (область между Belmayne/Marrsfield Ave, Park Ave, Main Street и Belmayne ave), иначе бот ответит, что в этом районе не работает.</p>
<p data-for="android">В чате с ботом нажмите скрепку справа в строке ввода, «Location», передвиньте указатель на нужное место и нажмите «Send selected location».</p>
<p data-for="iphone-bookmark" hidden>В чате с ботом нажмите скрепку слева от строки ввода, «Location», передвиньте указатель на нужное место и нажмите «Send selected location».</p>
<p>Бот напишет «Choose the address» и покажет адреса рядом с выбранным местом: нажмите подходящий. Если подходящего нет, нажмите «Other address» и напишите адрес сообщением.</p>
<p>Затем бот запросит фото машины. Для тестового репорта вы можете прислать любое фото, например, своей машины.</p>
<p>Нажмите “Create report”, бот запустит процесс подготовки репорта, пройдите его по шагам.</p>
<p data-for="android">В конце бот покажет готовое описание и спросит «Is everything correct?»: нажмите «Yes, it’s correct». Если бот еще не знает ваш тип телефона, он спросит «Your phone?»: нажмите «Android».</p>
<p data-for="iphone-bookmark" hidden>В конце бот покажет готовое описание и спросит «Is everything correct?»: нажмите «Yes, it’s correct». Если бот еще не знает ваш тип телефона, он спросит «Your phone?»: нажмите «iPhone».</p>
<p>Затем нажмите кнопку «Open report» под описанием, откроется страница Traffic Watch Online Reporting во встроенном браузере телеграма.</p>
<div data-for="android">
<p>Нажмите «⋮» вверху справа и «Open in Chrome browser».</p>
<p>Та же страница откроется в Chrome. Нажмите на адресную строку вверху (https://www.garda.ie/…) и наберите в ней qqqwww. Chrome покажет список подсказок, найдите в списке ☆ qqqwww (со звездочкой) и нажмите ее.</p>
</div>
<div data-for="iphone-bookmark" hidden>
<p>Если форма открылась внутри Telegram, нажмите «⋯» вверху и «Open in Safari».</p>
<p>Когда форма откроется, нажмите «⋯» внизу, «Bookmarks» и qqqwww.</p>
</div>
<p>Закладка покажет в верхней части страницы сообщение “StreetBuddy is running. Tick the two boxes below and press Click Here to Start”.</p>
<p>Поставьте две галочки на странице Traffic Watch Online Reporting: об отсутствии emergency и о явке в суд, нажмите «Click Here to Start» и проверьте, как заполнились поля формы.</p>
<p class="warn">ВНИМАНИЕ: проходить капчу и нажимать «Submit Report» для тестового репорта не нужно, иначе тестовые данные уйдут в Гарду.</p>
<p>Вернитесь в Telegram и под описанием тестового репорта нажмите «Cancel»: бот удалит это сообщение вместе с кнопками.</p>
<p>На этом установка закончена, теперь вы можете пользоваться ботом для отправки реальных репортов. Инструкция по использованию бота находится <a href="/manual">здесь</a>.</p>
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
