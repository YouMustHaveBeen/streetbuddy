// Manual page, served by the Worker.
import { BASE_STYLE, CHOICE_SCRIPT, htmlResponse, INSTALL_PATH } from "./install";

export const MANUAL_PATH = "/userguide";

type Os = "android" | "iphone";

// The language buttons are one group (CHOICE_SCRIPT); the phone buttons exist in every language, so the
// phone choice is shared by both languages.
const PAGE_SCRIPT = `(function () {
  "use strict";
  ${CHOICE_SCRIPT}
  bindChoice("lang");
  function setOs(os) {
    var buttons = document.querySelectorAll("[data-os]");
    for (var i = 0; i < buttons.length; i++) buttons[i].setAttribute("aria-pressed", String(buttons[i].getAttribute("data-os") === os));
    var sections = document.querySelectorAll("[data-os-section]");
    for (var j = 0; j < sections.length; j++) sections[j].hidden = sections[j].getAttribute("data-os-section") !== os;
  }
  var osButtons = document.querySelectorAll("[data-os]");
  for (var k = 0; k < osButtons.length; k++) {
    osButtons[k].addEventListener("click", function (event) { setOs(event.currentTarget.getAttribute("data-os")); });
  }
})();`;

const PARKING_LIST = `<ul>
<li>on a cycle track</li>
<li>on a footpath</li>
<li>on a grass margin</li>
<li>within 5m of a junction</li>
<li>blocking a private driveway</li>
<li>interfering with traffic flow</li>
<li>obstructing and endangering traffic</li>
</ul>`;

function guideRu(os: Os): string {
  const id = (n: string) => `ru-${os}-${n}`;
  const android = os === "android";
  const browser = android ? "Chrome" : "Safari";
  return `<section data-os-section="${os}"${android ? "" : " hidden"}>
<h2 id="${id("1")}">1 Перед началом</h2>
<p>Чтобы использовать бот, вам нужно один раз настроить ваш телефон согласно <a href="${INSTALL_PATH}">руководству по установке</a>: добавить в браузер ${browser} на вашем телефоне закладку с вашими личными данными.<br>
Бот не собирает и не хранит ваши личные данные, поэтому вам нужно заранее сохранить их на вашем телефоне, чтобы использовать в репорте.<br>
Если вы еще не создали закладку, вернитесь к этому руководству после установки.</p>

<h2 id="${id("2")}">2 Как подать репорт</h2>
<ul>
<li><a href="#${id("2.1")}">2.1. Укажите адрес</a></li>
<li><a href="#${id("2.2")}">2.2. Укажите номер</a></li>
<li><a href="#${id("2.3")}">2.3. Укажите тип нарушения</a></li>
<li><a href="#${id("2.4")}">2.4. Укажите вашу роль</a></li>
<li><a href="#${id("2.5")}">2.5. Проверьте данные</a></li>
<li><a href="#${id("2.6")}">2.6. Откройте форму для репортов</a></li>
<li><a href="#${id("2.7")}">2.7. Отошлите репорт</a></li>
<li><a href="#${id("2.8")}">2.8. Завершите репорт в боте</a></li>
</ul>

<h3 id="${id("2.1")}">2.1. Укажите адрес</h3>
<p>Откройте чат с ботом StreetBuddy в Telegram. Нажмите скрепку в строке ввода, затем «Location»; Telegram покажет карту с вашим текущим местоположением.</p>
<p>Если вы находитесь рядом с машиной, нажмите «Send selected location». Если вы находитесь в другом месте, сначала передвиньте указатель на карте на то место, где стоит машина, затем нажмите «Send selected location».</p>
<p>Бот проверит координаты и покажет два ближайших адреса с карты. Нажмите подходящий, и бот перейдет к фото. Если бот не смог найти подходящий адрес, нажмите «Other address» и напишите адрес сами.</p>
<p>Бот работает только в районе, указанном на карте (область между Belmayne/Marrsfield Ave, Park Ave, Main Street и Belmayne ave), поэтому если прислать ему местоположение вне района, репорт не будет создан.</p>

<h3 id="${id("2.2")}">2.2. Укажите номер</h3>
<p>После определения адреса бот предложит прислать фото с номером машины для распознавания или ввести номер вручную. Отправьте фото машины или вместо фото напишите номер машины сообщением боту.</p>
<p>Для создания репорта достаточно одного фото с номером машины. Его можно снять прямо из чата в процессе создания репорта (скрепка - камера) или прислать боту сохраненное ранее фото.</p>
<p>Вы можете прислать дополнительные фото, показывающие, где и как стоит машина. Бот не будет их анализировать, они будут храниться все вместе над описанием репорта для вашего удобства.</p>
<p>Отправляйте именно фото, а не файл: файл бот не принимает.</p>
<p>Если на фото несколько машин и бот распознал несколько номеров на фото, он предложит выбрать верный. Если нужного номера нет, нажмите «Add» и напишите номер сообщением.</p>
<p>Если бот не смог прочитать номер, напишите номер сообщением.</p>
<p>Когда все фото отправлены, нажмите «Create report».</p>

<h3 id="${id("2.3")}">2.3. Укажите тип нарушения</h3>
<p>Бот предложит варианты нарушений, выберите подходящие варианты. Рядом с выбранным вариантом появится ✅, повторное нажатие его снимает. Выбрать нужно хотя бы один вариант:</p>
${PARKING_LIST}
<p>Затем нажмите «Done».</p>

<h3 id="${id("2.4")}">2.4. Укажите вашу роль</h3>
<p>Последнее поле для заполнения - ваша роль:</p>
<ul>
<li>pedestrian;</li>
<li>passenger;</li>
<li>driver;</li>
<li>cyclist;</li>
<li>motorcyclist;</li>
<li>e-scooter user, e-moped user, e-cyclist.</li>
</ul>

<h3 id="${id("2.5")}">2.5. Проверьте данные</h3>
<p>Далее бот покажет готовое описание нарушения (номер машины, описание нарушения, адрес, дату, время и роль) для проверки и даст возможность внести исправления.</p>
<p>После подтверждения корректности данных бот уберет свои промежуточные сообщения и пришлет итоговое сообщение с описанием нарушения. Первые 10 репортов под описанием нарушения бот показывает список шагов, которые нужно сделать дальше.</p>
<p>Если бот не знает тип вашего телефона (при первом репорте или если вы не пользовались ботом больше двух месяцев), он попросит выбрать между «iPhone» и «Android», чтобы выдать подходящий список следующих шагов.</p>

<h3 id="${id("2.6")}">2.6. Откройте форму для репортов</h3>
${
    android
      ? `<p>Нажмите кнопку «Open report». Форма Traffic Watch Online Reporting откроется во встроенном браузере Telegram.<br>
Закладка с вашими личными данными в нем не работает, поэтому откройте ее в Chrome: проведите по экрану телефона вниз, чтобы сверху открылась панель, нажмите в ней «⋮» справа и «Open in Chrome browser».</p>
<p>Когда форма для репортов Traffic Watch Online Reporting откроется в Chrome, нажмите на адресную строку вверху (https://www.garda.ie/en/trafficwatchreport…).<br>
Откроется страница поиска, в самой верхней строке будет текст «Search Google or type URL».</p>
<p>Наберите прямо в этой строке qqqwww, Google покажет найденные варианты ниже.<br>
Найдите в вариантах вашу закладку qqqwww (со значком звезды) и нажмите на нее, Chrome откроет форму для репортов снова.</p>`
      : `<p>Нажмите кнопку «Open report». Форма Traffic Watch Online Reporting откроется во встроенном браузере Telegram.<br>
Закладка с вашими личными данными в нем не работает, поэтому откройте ее в Safari: проведите по экрану телефона вниз, чтобы сверху открылась панель, нажмите в ней «⋯» и «Open in Safari».</p>
<p>Когда форма для репортов Traffic Watch Online Reporting откроется в Safari, нажмите в панели снизу «⋯», затем в самом низу на «📖 Bookmarks», и на открывшейся странице найдите вашу закладку qqqwww.<br>
Нажмите на нее, Safari откроет форму для репортов снова.</p>`
  }

<h3 id="${id("2.7")}">2.7. Отошлите репорт</h3>
<p>На странице формы для репортов поставьте две галочки: «I confirm that this is not an emergency» и «I confirm that I am willing to make a statement and attend Court», нажмите «Click Here to Start».</p>
<p>Скрипт в закладке заполнит поля репорта сам.</p>
<p>Проверьте все поля, исправьте текст, при необходимости, пройдите капчу «I'm not a robot» и нажмите «Submit Report». Подтверждение с номером репорта придет на ваш email.</p>

<h3 id="${id("2.8")}">2.8. Завершите репорт в боте</h3>
<p>Вернитесь в Telegram и нажмите «Done» под описанием репорта: бот уберет кнопки и допишет, когда репорт был отправлен.<br>
Если вы решили не отправлять репорт, нажмите «Cancel»: бот удалит описание репорта.<br>
Если не нажать ни одну из кнопок, ближайшая очистка после 48 часов уберет кнопки, оставив описание репорта.</p>
<p>Присланные вами фотографии бот не удаляет, они остаются в чате с ботом на случай, если у вас их запросят.</p>

<h2 id="${id("3")}">3 Команды бота</h2>
<p>Команды открываются кнопкой «Menu» рядом со строкой ввода. Любая команда останавливает начатый репорт.</p>
<ul>
<li>/map: присылает «Area map» - карту адресов района. Ссылка на карту работает один час, потом отправьте /map снова.</li>
<li>/hotspots: показывает «Hotspots» - точки на карте, где были оставлены репорты не менее чем на 10 разных номеров машин.</li>
<li>/add_address: добавить адрес. Если вы хотите дополнить карту, вам нужно прислать локейшн, адрес и выбрать тип: «house» (дом с номером), «appt» (многоквартирный дом), «facility» (магазин, школа, остановка и подобное), «spot» (место без номера дома: перекресток, улица, ориентир для репорта). Перед добавлением на карту адрес попадет к админам на проверку.</li>
<li>/invite: команда выдает вам ссылку, по которой вы можете пригласить соседей в группу.</li>
<li>/phone: команда позволяет указать ваш тип телефона, чтобы напоминать шаги для выбранного телефона под описанием репорта. Подсказка работает первые 10 репортов, затем исчезает. Чтобы ее вернуть, нужно снова выбрать телефон.</li>
<li>/help: показывает ссылки на Setup guide и User guide.</li>
<li>/feedback: здесь вы можете написать админам о проблемах в работе бота или предложить новый функционал.</li>
</ul>

<h2 id="${id("4")}">4 Полезно знать</h2>
<ul>
<li>Отсылка репорта может потребовать дачи показаний в суде.</li>
<li>Бот не получает и не хранит ваши имя, фамилию, телефон, email и адрес: они хранятся только в закладке на вашем телефоне.</li>
<li>В качестве времени и даты нарушения бот указывает время и дату отправки первой фотографии или ввода номера машины текстом.</li>
<li>Бот принимает только актуальные нарушения, поэтому дату репорта редактировать нельзя.</li>
<li>Если вы бросили репорт на середине, бот удалит черновик из своей базы через 24 часа. Текст готового описания репорта бот хранит, пока вы не нажали «Cancel» или «Done», но не дольше 48 часов.</li>
</ul>
</section>`;
}

function guideEn(os: Os): string {
  const id = (n: string) => `en-${os}-${n}`;
  const android = os === "android";
  const browser = android ? "Chrome" : "Safari";
  return `<section data-os-section="${os}"${android ? "" : " hidden"}>
<h2 id="${id("1")}">1 Before you start</h2>
<p>To use the bot, you need to set up your phone once, following the <a href="${INSTALL_PATH}">setup guide</a>: add a bookmark with your personal data to the ${browser} browser on your phone.<br>
The bot does not collect or store your personal data, so you need to save it on your phone beforehand to use it in a report.<br>
If you have not created the bookmark yet, come back to this guide after the setup.</p>

<h2 id="${id("2")}">2 How to file a report</h2>
<ul>
<li><a href="#${id("2.1")}">2.1. Give the address</a></li>
<li><a href="#${id("2.2")}">2.2. Give the plate number</a></li>
<li><a href="#${id("2.3")}">2.3. Give the type of the violation</a></li>
<li><a href="#${id("2.4")}">2.4. Give your role</a></li>
<li><a href="#${id("2.5")}">2.5. Check the data</a></li>
<li><a href="#${id("2.6")}">2.6. Open the report form</a></li>
<li><a href="#${id("2.7")}">2.7. Send the report</a></li>
<li><a href="#${id("2.8")}">2.8. Finish the report in the bot</a></li>
</ul>

<h3 id="${id("2.1")}">2.1. Give the address</h3>
<p>Open the chat with the StreetBuddy bot in Telegram. Tap the paperclip in the input bar, then «Location»; Telegram will show a map with your current location.</p>
<p>If you are next to the car, tap «Send selected location». If you are somewhere else, first move the pin on the map to the place where the car is parked, then tap «Send selected location».</p>
<p>The bot will check the coordinates and show the two nearest addresses from the map. Tap the right one, and the bot will move on to the photos. If the bot could not find a suitable address, tap «Other address» and write the address yourself.</p>
<p>The bot works only in the area shown on the map (the area between Belmayne/Marrsfield Ave, Park Ave, Main Street and Belmayne ave), so if you send it a location outside the area, the report will not be created.</p>

<h3 id="${id("2.2")}">2.2. Give the plate number</h3>
<p>After the address is set, the bot will ask you to send a photo with the number plate for recognition or to type the plate number yourself. Send a photo of the car, or write the plate number to the bot instead of a photo.</p>
<p>One photo with the number plate is enough to create a report. You can take it right from the chat while creating the report (paperclip - camera) or send the bot a photo saved earlier.</p>
<p>You can send additional photos that show where and how the car is parked. The bot will not analyse them; they will all be kept together above the report description for your convenience.</p>
<p>Send a photo, not a file: the bot does not accept files.</p>
<p>If there are several cars in the photo and the bot recognised several plates, it will offer you to choose the right one. If the plate you need is not there, tap «Add» and write the plate number as a message.</p>
<p>If the bot could not read the plate, write the plate number as a message.</p>
<p>When all the photos are sent, tap «Create report».</p>

<h3 id="${id("2.3")}">2.3. Give the type of the violation</h3>
<p>The bot will offer the options for the violation; choose the ones that fit. A ✅ appears next to a chosen option, and tapping it again removes it. You must choose at least one option:</p>
${PARKING_LIST}
<p>Then tap «Done».</p>

<h3 id="${id("2.4")}">2.4. Give your role</h3>
<p>The last field to fill in is your role:</p>
<ul>
<li>pedestrian;</li>
<li>passenger;</li>
<li>driver;</li>
<li>cyclist;</li>
<li>motorcyclist;</li>
<li>e-scooter user, e-moped user, e-cyclist.</li>
</ul>

<h3 id="${id("2.5")}">2.5. Check the data</h3>
<p>Next, the bot will show the ready description of the violation (the plate number, the description of the violation, the address, the date, the time and the role) for you to check, and will let you make corrections.</p>
<p>After you confirm that the data is correct, the bot will remove its intermediate messages and send the final message with the description of the violation. For your first 10 reports, the bot shows a list of the next steps under the description.</p>
<p>If the bot does not know your phone type (for your first report, or if you have not used the bot for more than two months), it will ask you to choose between «iPhone» and «Android», to give you the right list of next steps.</p>

<h3 id="${id("2.6")}">2.6. Open the report form</h3>
${
    android
      ? `<p>Tap the «Open report» button. The Traffic Watch Online Reporting form will open in Telegram's built-in browser.<br>
The bookmark with your personal data does not work there, so open the form in Chrome: swipe down on the phone screen so that a bar opens at the top, tap «⋮» on the right in it and then «Open in Chrome browser».</p>
<p>When the Traffic Watch Online Reporting form opens in Chrome, tap the address bar at the top (https://www.garda.ie/en/trafficwatchreport…).<br>
A search page will open, and the top line will say «Search Google or type URL».</p>
<p>Type qqqwww right in this line, and Google will show the matches below.<br>
Find your bookmark qqqwww (with a star icon) among them and tap it, and Chrome will open the report form again.</p>`
      : `<p>Tap the «Open report» button. The Traffic Watch Online Reporting form will open in Telegram's built-in browser.<br>
The bookmark with your personal data does not work there, so open the form in Safari: swipe down on the phone screen so that a bar opens at the top, tap «⋯» in it and then «Open in Safari».</p>
<p>When the Traffic Watch Online Reporting form opens in Safari, tap «⋯» in the bar at the bottom, then «📖 Bookmarks» at the very bottom, and on the page that opens find your bookmark qqqwww.<br>
Tap it, and Safari will open the report form again.</p>`
  }

<h3 id="${id("2.7")}">2.7. Send the report</h3>
<p>On the report form page, tick the two boxes: «I confirm that this is not an emergency» and «I confirm that I am willing to make a statement and attend Court», then tap «Click Here to Start».</p>
<p>The script in the bookmark will fill in the report fields by itself.</p>
<p>Check all the fields, correct the text if necessary, pass the captcha «I'm not a robot» and tap «Submit Report». The confirmation with the report number will arrive at your email.</p>

<h3 id="${id("2.8")}">2.8. Finish the report in the bot</h3>
<p>Go back to Telegram and tap «Done» under the report description: the bot will remove the buttons and add when the report was sent.<br>
If you decided not to send the report, tap «Cancel»: the bot will delete the report description.<br>
If you tap neither button, the next cleanup after 48 hours will remove the buttons and leave the report description.</p>
<p>The bot does not delete the photos you sent; they stay in the chat with the bot in case you are asked for them.</p>

<h2 id="${id("3")}">3 Bot commands</h2>
<p>The commands open with the «Menu» button next to the input bar. Any command stops a report you have started.</p>
<ul>
<li>/map: sends «Area map», a map of the addresses of the area. The link to the map works for one hour, then send /map again.</li>
<li>/hotspots: shows «Hotspots», the points on the map where reports were left for at least 10 different car plates.</li>
<li>/add_address: add an address. If you want to add to the map, you need to send a location and an address and choose a type: «house» (a house with a number), «appt» (an apartment block), «facility» (a shop, a school, a bus stop and the like), «spot» (a place without a house number: a crossroad, a street, a landmark for a report). Before it is added to the map, the address goes to the admins for checking.</li>
<li>/invite: gives you a link with which you can invite neighbours to the group.</li>
<li>/phone: lets you set your phone type, so that the bot reminds you of the steps for the chosen phone under the report description. The hint works for the first 10 reports and then disappears. To bring it back, choose the phone again.</li>
<li>/help: shows the links to the Setup guide and the User guide.</li>
<li>/feedback: here you can write to the admins about problems in the bot's work or suggest a new feature.</li>
</ul>

<h2 id="${id("4")}">4 Good to know</h2>
<ul>
<li>Sending a report may require you to give a statement in court.</li>
<li>The bot does not receive or store your name, surname, phone, email and address: they are stored only in the bookmark on your phone.</li>
<li>As the time and date of the violation, the bot uses the time and date when the first photo was sent or when the plate number was typed.</li>
<li>The bot accepts only recent violations, so the date of a report cannot be edited.</li>
<li>If you abandon a report halfway, the bot deletes the draft from its database after 24 hours. The bot keeps the text of the ready report description until you tap «Cancel» or «Done», but no longer than 48 hours.</li>
</ul>
</section>`;
}

const PHONE_CHOICE = `<p class="choice"><button type="button" aria-pressed="true" data-os="android">Android</button><button type="button" aria-pressed="false" data-os="iphone">iPhone</button></p>`;

// Static page.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreetBuddy User guide</title>
<style>
${BASE_STYLE}
</style>
</head>
<body>
<main>
<p class="choice"><button type="button" aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ru">Russian</button></p>
<div lang="en" data-lang-section="en">
<h1>StreetBuddy User guide</h1>
<p>StreetBuddy is a Telegram bot that helps you prepare a report for the Traffic Watch Online Reporting portal. The bot does not send reports: a script in a browser bookmark on your phone fills in the report fields, but you tick the boxes, enter the captcha and tap the «Submit Report» button yourself.</p>
<p>The bot accepts reports only about illegal parking (Parking Offences) and only from the area where it works: Parkside and Fr Collins Park and the immediate surroundings (the area between Belmayne/Marrsfield Ave, Park Ave, Main Street and Belmayne ave).</p>
<p>To use the bot, you need to be a member of the Street Buddy Group; the group is how the bot's users are authorised.</p>
<h2>What phone do you have?</h2>
${PHONE_CHOICE}
${guideEn("android")}
${guideEn("iphone")}
</div>
<div lang="ru" data-lang-section="ru" hidden>
<h1>Руководство по использованию StreetBuddy</h1>
<p>StreetBuddy - Telegram-бот, который помогает подготовить репорт для портала Traffic Watch Online Reporting. Бот не отправляет репорты: скрипт в закладке браузера на вашем телефоне заполняет поля репорта, но ставите галочки, вводите капчу и нажимаете кнопку «Submit Report» вы сами.</p>
<p>Бот принимает репорты только о неправильной парковке (Parking Offences) и только из района, где он работает: Parkside и Fr Collins Park и непосредственно вокруг них (область между Belmayne/Marrsfield Ave, Park Ave, Main Street и Belmayne ave).</p>
<p>Чтобы пользоваться ботом, нужно состоять в группе Street Buddy Group, группа обеспечивает авторизацию пользователей бота.</p>
<h2>Какой у вас телефон?</h2>
${PHONE_CHOICE}
${guideRu("android")}
${guideRu("iphone")}
</div>
</main>
<script>
${PAGE_SCRIPT}
</script>
</body>
</html>
`;

export function manualPage(): Response {
  return htmlResponse(PAGE);
}
