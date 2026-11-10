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
        var value = event.currentTarget.getAttribute("data-" + key);
        for (var j = 0; j < buttons.length; j++) {
          buttons[j].setAttribute("aria-pressed", String(buttons[j].getAttribute("data-" + key) === value));
        }
        onChoice(value);
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

  function setUpForm(form) {
    var error = form.querySelector(".bookmark-error");
    var prepared = form.querySelector(".bookmark-prepared");
    var copyFailed = form.querySelector(".bookmark-copy-failed");
    var code = form.querySelector(".bookmark-code");

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
  }

  var forms = document.querySelectorAll(".bookmark-form");
  for (var f = 0; f < forms.length; f++) setUpForm(forms[f]);
})();`;

// The guide in each language: English first.
const GUIDE_EN = `<h1>StreetBuddy<br>Installation guide</h1>
<p>To send a report about illegal parking on the Traffic Watch Online Reporting portal, you need to fill in 11 fields:</p>
<p>6 fields describing the violation:</p>
<ol>
<li>Address,</li>
<li>County,</li>
<li>Type of violation,</li>
<li>Your role,</li>
<li>Description of the violation, including the vehicle's number plate,</li>
<li>Date of the violation,</li>
</ol>
<p>and 5 fields containing your personal information:</p>
<ol start="7">
<li>First name and last name,</li>
<li>Phone,</li>
<li>Email,</li>
<li>Address,</li>
<li>How you wish to be contacted.</li>
</ol>
<p>The StreetBuddy bot helps you speed this up.</p>
<p>Before you use the bot, you enter and save your personal details needed for the report (items 7-11) once, on your phone. They are not sent anywhere: they are saved in a bookmark in your browser and used later in every report. The bot does not read or store your personal details.</p>
<p>When you want to send a report, you send the bot a location and a photo of the car, the bot offers you text options to choose from, fills in the fields that describe the violation (items 1-6) and gives you a link for your browser.</p>
<p>You open this link in Google Chrome if you have an Android phone, or in Safari if you have an iPhone, then open the bookmark with your personal details in the same browser, and end up with a page where all 11 fields are filled in.</p>
<p>You send the finished report yourself by pressing the “Submit Report” button in the browser on your phone.</p>
<p>Why does the bot work this way, through links and bookmarks? Because this way you do not have to install any additional apps on your phone, and the rules of use of the Garda website are not broken.</p>
<p>To use the bot, you need to set up the browser on your phone using the instructions below.</p>

<h2>What phone do you have?</h2>
<p class="choice"><button type="button" aria-pressed="true" data-os="android">Android</button><button type="button" aria-pressed="false" data-os="iphone">iPhone</button></p>

<section>
<div data-for="android">
<p>You will need to:</p>
<ul>
<li>open the Chrome browser,</li>
<li>enter your personal details,</li>
<li>prepare the bookmark,</li>
<li>add the bookmark to Chrome,</li>
<li>create and cancel a test report</li>
</ul>

<h3>1. Open this guide in Chrome</h3>
<p>If you are reading this guide on a computer, it is time to switch to your phone: the bot works and is set up on the phone.</p>
<p>By default, Telegram opens links on the phone in its built-in browser, but you need the Chrome browser. Swipe down on the phone screen so that the panel opens at the top, tap “⋮” on the right in it and choose “Open in Chrome browser”; the guide will open in Chrome.</p>
</div>

<div data-for="iphone-bookmark" hidden>
<p>You will need to:</p>
<ul>
<li>open the Safari browser,</li>
<li>enter your personal details,</li>
<li>prepare the bookmark,</li>
<li>add the bookmark to Safari,</li>
<li>create and cancel a test report</li>
</ul>

<h3>1. Open this guide in Safari</h3>
<p>If you are reading this guide on a computer, it is time to switch to your phone: the bot works and is set up on the phone.</p>
<p>By default, Telegram opens links on the phone in its built-in browser, but you need the Safari browser. Swipe down on the phone screen so that the panel opens at the top, tap “⋯” in it and choose “Open in Safari”; the guide will open in Safari.</p>
</div>

<form id="bookmark-form-en" class="bookmark-form" novalidate>
<h3>2. Enter your personal details</h3>
<p>To create a bookmark with your details, the bot needs to put the data together. The bot does not send it anywhere: it stays on this page, on your phone.</p>
<p>Enter your details in the fields below.</p>
<label>First Name and Last Name<input name="name" type="text"></label>
<label>Phone<input name="phone" type="tel"></label>
<label>Email<input name="email" type="email"></label>
<label>Address<input name="address" type="text"></label>
<label>How you wish to be contacted<select name="contact"><option value="" selected></option><option>Email</option><option>Phone Call</option><option>Text Message</option></select></label>

<h3>3. Prepare the bookmark</h3>
<p>The “Prepare bookmark” button checks the entered data, builds a code from it and puts this code into the clipboard, so that you can paste it into the bookmark.</p>
<p>Press the “Prepare bookmark” button.</p>
<p><button class="install" type="submit">Prepare bookmark</button></p>
<p class="bookmark-prepared ok" role="status" hidden>Bookmark prepared</p>
<p class="bookmark-error" role="alert" hidden>Fill in all fields. The email must look like name@example.com.</p>
<p class="bookmark-copy-failed warn" role="alert" hidden>Could not copy the code automatically. Copy it from the field below: long-press the field, “Select all”, “Copy”</p>
<textarea class="bookmark-code" aria-label="Bookmark code" rows="6" readonly hidden></textarea>
</form>

<div data-for="android">
<h3>4. Add the bookmark to Chrome</h3>
<p>Add the guide page that you are reading now to your bookmarks.</p>
<p>To do this, swipe down on the phone screen so that the panel opens at the top, tap “⋮” on the right in it, then ☆ Bookmarks.</p>
<p>A bookmark named StreetBuddy with a link to this guide will be added in Chrome.</p>
<p>Next you need to change the name of the bookmark and its address.</p>
<p>Tap “⋮” at the top right again, then ★ Bookmarks, and find StreetBuddy in the list of bookmarks.</p>
<p>Tap “⋮” to the right of the bookmark name, then Edit.</p>
<p>In the bookmark name field, delete StreetBuddy and type the new name: qqqwww. You can use any other name you like, but keep in mind that the name must be as rare as possible, otherwise Chrome will suggest other options when you search for the bookmark.</p>
<p>In the bookmark address field, delete the address of the guide and paste the code from the clipboard: long-press the old address, “Paste”.</p>
<p>Go back with the “Back” button (the triangle): the bookmark will be saved in its new form, and the browser setup is complete.</p>
<p>The bookmark contains your personal details, do not forward it to anyone.</p>
<p>Do not open the qqqwww bookmark from the list of bookmarks: it will open on an empty page and will not work. Use the bookmark only on the report page opened with the link prepared by the bot. You can read how to use the bookmark in the Manual.</p>
</div>

<div data-for="iphone-bookmark" hidden>
<h3>4. Add the bookmark to Safari</h3>
<p>Add the guide page that you are reading now to your bookmarks.</p>
<p>To do this, swipe down on the phone screen so that the panel opens at the top, tap “⋯” on the right in it, then “Add to Bookmark”.</p>
<p>A bookmark named StreetBuddy with a link to this guide will be added in Safari.</p>
<p>Next you need to change the name of the bookmark and its address.</p>
<p>Tap “⋯” at the bottom right again, then 📖 Bookmarks, and find StreetBuddy in the list of bookmarks.</p>
<p>Long-press the bookmark to open the pop-up menu with bookmark actions, tap “Edit”.</p>
<p>In the bookmark name field, delete StreetBuddy and type the new name: qqqwww. You can use any other name you like, but keep in mind that the name must be as rare as possible, otherwise Safari will suggest other options when you search for the bookmark.</p>
<p>In the bookmark address field, delete the address of the guide and paste the code from the clipboard: long-press the old address, tap the cross on the right, long-press again, “Paste”.</p>
<p>Save the bookmark with the “Save” button: the bookmark will be saved in its new form, and the browser setup is complete.</p>
<p>The bookmark contains your personal details, do not forward it to anyone.</p>
<p>Run the qqqwww bookmark only on an open report form.</p>
</div>

<h3>5. Create and cancel a test report</h3>
<p class="warn">WARNING: do not press “Submit Report” for the test report.</p>
<p>In Telegram, send the StreetBuddy bot a location.</p>
<p>For the test report, choose a place in the area where the bot works (the area between Belmayne/Marrsfield Ave, Park Ave, Main Street and Belmayne ave), otherwise the bot will answer that it does not work in this area.</p>
<p data-for="android">In the chat with the bot, tap the paperclip on the right of the input line, “Location”, move the pointer to the place you need and tap “Send selected location”.</p>
<p data-for="iphone-bookmark" hidden>In the chat with the bot, tap the paperclip on the left of the input line, “Location”, move the pointer to the place you need and tap “Send selected location”.</p>
<p>The bot will write “Choose the address” and show the addresses near the selected place: tap the suitable one. If there is no suitable one, tap “Other address” and write the address in a message.</p>
<p>Then the bot will ask for a photo of the car. For the test report you can send any photo, for example of your own car.</p>
<p>Tap “Create report”, the bot will start preparing the report, go through it step by step.</p>
<p data-for="android">At the end the bot will show the finished description and ask “Is everything correct?”: tap “Yes, it’s correct”. If the bot does not yet know your phone type, it will ask “Your phone?”: tap “Android”.</p>
<p data-for="iphone-bookmark" hidden>At the end the bot will show the finished description and ask “Is everything correct?”: tap “Yes, it’s correct”. If the bot does not yet know your phone type, it will ask “Your phone?”: tap “iPhone”.</p>
<p>Then tap the “Open report” button under the description; the Traffic Watch Online Reporting page will open in Telegram's built-in browser.</p>
<div data-for="android">
<p>Tap “⋮” at the top right and “Open in Chrome browser”.</p>
<p>The same page will open in Chrome. Tap the address bar at the top (https://www.garda.ie/…) and type qqqwww in it. Chrome will show a list of suggestions, find ☆ qqqwww (with a star) in the list and tap it.</p>
</div>
<div data-for="iphone-bookmark" hidden>
<p>If the form opened inside Telegram, tap “⋯” at the top and “Open in Safari”.</p>
<p>When the form opens, tap “⋯” at the bottom, “Bookmarks” and qqqwww.</p>
</div>
<p>The bookmark will show the message “StreetBuddy is running. Tick the two boxes below and press Click Here to Start” at the top of the page.</p>
<p>Tick the two boxes on the Traffic Watch Online Reporting page: about this not being an emergency and about attending court, tap “Click Here to Start” and check how the form fields were filled in.</p>
<p class="warn">WARNING: you do not need to pass the captcha or press “Submit Report” for the test report, otherwise the test data will be sent to Garda.</p>
<p>Go back to Telegram and tap “Cancel” under the description of the test report: the bot will delete this message together with the buttons.</p>
<p>This completes the setup, now you can use the bot to send real reports. The instructions for using the bot are <a href="/manual">here</a>.</p>
</section>`;

const GUIDE_RU = `<h1>StreetBuddy<br>Руководство по установке</h1>
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

<form id="bookmark-form-ru" class="bookmark-form" novalidate>
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
<p class="bookmark-prepared ok" role="status" hidden>Закладка подготовлена</p>
<p class="bookmark-error" role="alert" hidden>Заполните все поля. Email должен быть в виде name@example.com.</p>
<p class="bookmark-copy-failed warn" role="alert" hidden>Не получилось скопировать код автоматически. Скопируйте его из поля ниже: долгое нажатие на поле, «Select all», «Copy»</p>
<textarea class="bookmark-code" aria-label="Код закладки" rows="6" readonly hidden></textarea>
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
<p>Не открывайте закладку qqqwww из списка закладок: так она откроется на пустой странице и не сработает. Используйте закладку только на странице репорта, открытой по подготовленной ботом ссылке. Прочитать о том, как использовать закладку, можно в Мануале.</p>
</div>

<div data-for="iphone-bookmark" hidden>
<h3>4. Добавьте закладку в Safari</h3>
<p>Добавьте страницу руководства, которую вы сейчас читаете, в закладки.</p>
<p>Для этого проведите по экрану телефона вниз, чтобы сверху открылась панель, нажмите в ней «⋯» справа, затем «Add to Bookmark».</p>
<p>В Safari будет добавлена закладка с именем StreetBuddy и ссылкой на это руководство.</p>
<p>Далее нужно изменить название закладки и ее текст.</p>
<p>Снова нажмите справа снизу «⋯», затем 📖 Bookmarks, найдите в списке закладок StreetBuddy.</p>
<p>Долгим нажатием на закладку откройте всплывающий экран для операций с закладкой, нажмите «Edit».</p>
<p>В поле названия закладки сотрите StreetBuddy и напишите новое название: qqqwww. Можно использовать для названия любой другой удобный вам вариант, но учтите, что название должно быть максимально редким, иначе Safari при поиске закладки будет предлагать другие варианты.</p>
<p>В поле адреса закладки сотрите адрес руководства и вставьте находящийся в буфере код: долгое нажатие на старый адрес, крестик справа, снова долгое нажатие, «Paste».</p>
<p>Сохраните закладку кнопкой «Save»: закладка сохранится в новом виде, настройка браузера завершена.</p>
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
</section>`;

// Static page.
const PAGE = `<!doctype html>
<html lang="en">
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
<p class="choice"><button type="button" aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ru">Русский</button></p>
<div lang="en" data-lang-section="en">
${GUIDE_EN}
</div>
<div lang="ru" data-lang-section="ru" hidden>
${GUIDE_RU}
</div>
</main>
<script>
${CHOICE_SCRIPT}
bindChoice("lang");
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
