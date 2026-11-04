// Installation guide page and the userscript file, both served by the Worker.
import userscript from "../userscript/streetbuddy.user.js";

export const INSTALL_PATH = "/install";
export const SCRIPT_PATH = "/streetbuddy.user.js";

const FIREFOX_URL = "https://play.google.com/store/apps/details?id=org.mozilla.firefox";
const VIOLENTMONKEY_URL = "https://addons.mozilla.org/firefox/addon/violentmonkey/";

// Static page: no user input is ever put into it, so nothing here is escaped.
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
  .install { display: inline-block; padding: 10px 20px; border: 2px solid; border-radius: 6px; font-weight: bold; text-decoration: none; }
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
<p class="choice"><button type="button" aria-pressed="true">Firefox</button><button type="button" disabled>Chrome</button></p>

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

<p>Бот не получает и не хранит ваши имя, фамилию, телефон, email и адрес.</p>
<p>Если вы бросили репорт на середине, бот удалит его данные из своей базы через 24 часа. Текст готового описания бот хранит, пока вы не нажали «Cancel» или «Done», но не дольше 48 часов.</p>
</main>
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
