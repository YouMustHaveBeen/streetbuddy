// Privacy policy page, served by the Worker.
import { BASE_STYLE, CHOICE_SCRIPT, htmlResponse } from "./install";

export const PRIVACY_PATH = "/privacy";

const PAGE_SCRIPT = `(function () {
  "use strict";
  ${CHOICE_SCRIPT}
  bindChoice("lang");
})();`;

const TABLE_STYLE = `  table { border-collapse: collapse; }
  th, td { border: 1px solid #888; padding: 4px 8px; text-align: left; vertical-align: top; }`;

const POLICY_EN = `<h2>Who runs StreetBuddy</h2>
<p>StreetBuddy is run by one of your neighbours, not by a company. It helps people in the area prepare Traffic Watch reports about illegal parking, and only members of the closed Street Buddy Group can use it. The bot is not connected to An Garda Síochána.</p>
<p>The operator of the bot, and the contact for any question about your data, is the owner of the closed group. Write to the owner in Telegram.</p>
<p>The bot handles your data because you agreed to it by joining the group. If you no longer agree, leave the group.</p>
<h2>What the bot knows about you, and why</h2>
<p>The bot only needs what it takes to put a report together:</p>
<ul>
<li><strong>Your Telegram ID</strong>, to check that you are in the group and to keep your phone choice.</li>
<li><strong>The location you send</strong>, to find the address and to check that the car is in the area.</li>
<li><strong>The plate number</strong>, read from your photo or typed by you, and the address, the type of violation, the date and the time of the report.</li>
<li><strong>Addresses you type or add yourself</strong>, with your Telegram ID, until an admin decides on them.</li>
<li><strong>Your feedback and your invite requests</strong>, if you use /feedback or /invite.</li>
</ul>
<p>The photo itself is not saved by the bot. It is read in memory and dropped. Plate numbers and people in photos count as personal data, so the bot does not keep photos: they stay in your own chat with the bot.</p>
<h2>What the bot does not get</h2>
<p>Your name, surname, phone, email and home address never reach the bot or its server. They are stored only in the bookmark on your phone, and the bookmark script fills them into the Traffic Watch form there. The part of the report link after the # does not even go to the Traffic Watch server, and the script removes it from the address bar as soon as it has read it.</p>
<h2>Who else sees something</h2>
<p>A few services help the bot work, and each of them sees a part of the data:</p>
<ul>
<li><strong>Telegram</strong> carries all your messages and photos, and keeps them in your chat on its servers.</li>
<li><strong>Cloudflare</strong> hosts the bot and its database. Your photo is sent to Cloudflare's Workers AI only to read the plate, and the result is kept for 24 hours so the same photo is not read twice.</li>
<li><strong>OpenStreetMap (Nominatim)</strong> gets the coordinates when the bot has no address of its own within 30 m of your location.</li>
<li><strong>Mapbox</strong> shows the maps on the bot's web pages, so your browser talks to Mapbox when you open a map.</li>
<li><strong>The bot's server</strong> answers when your bookmark loads the script file, so it sees the request address and your IP address, like any website. The script runs on the Traffic Watch page every time you use the bookmark, so you are trusting whoever runs the bot with that.</li>
</ul>
<p>The bot never sends a report. You send it yourself from the Traffic Watch form, and the admins of the group see only what the bot shows them: addresses waiting for approval, feedback, invite requests with names, lists of plates that were reported many times or are possibly abandoned, and a map of where and when reports were made.</p>
<h2>How long things are kept</h2>
<p>The bot cleans up by itself, twice a day.</p>
<table>
<tr><th>What</th><th>How long</th></tr>
<tr><td>Draft of the report you are making</td><td>24 hours</td></tr>
<tr><td>Text of the final message (plate, address, date), to keep the Done and Cancel buttons working</td><td>until you tap Done or Cancel, at most 48 hours</td></tr>
<tr><td>Result of reading a photo</td><td>24 hours</td></tr>
<tr><td>Report log: plate, date, type of violation, address and location coordinates (no Telegram ID)</td><td>66 days</td></tr>
<tr><td>Your Telegram ID with the date you last used the bot, your phone choice and link counter</td><td>2 months after the last use</td></tr>
<tr><td>Feedback you wrote, with your Telegram ID</td><td>2 months</td></tr>
<tr><td>Invite link you made</td><td>7 days</td></tr>
<tr><td>Join requests: who invited whom and the decision</td><td>2 months</td></tr>
<tr><td>An address you typed or added, with your Telegram ID, while waiting for an admin</td><td>until the admin decides, at most 2 months; your Telegram ID is erased once it is decided</td></tr>
<tr><td>Approved addresses on the map</td><td>until an admin deletes them</td></tr>
<tr><td>Daily counts with no names or plates (how many links, which violation types)</td><td>no limit</td></tr>
</table>
<p>Photos are not stored by the bot at all. They stay in your own chat with the bot until you delete them there.</p>
<h2>Your rights</h2>
<p>To delete your data from the bot's database, send /forget_me to the bot: it deletes the data and removes you from the group, because the group is how access to the bot is controlled. You can join the group again by invitation.</p>
<p>You can stop at any time: leave the group. The bot stops answering you within an hour; buttons already in your chat may still work for a while.</p>
<h2>Changes to this text</h2>
<p>If the bot starts handling data in a new way, this text is updated first.</p>`;

const POLICY_RU = `<h2>Кто делает StreetBuddy</h2>
<p>StreetBuddy делает один из ваших соседей, а не компания. Бот помогает подготовить репорты Traffic Watch о неправильной парковке, и пользоваться им могут только участники закрытой группы Street Buddy Group. К Garda бот отношения не имеет.</p>
<p>Оператор бота и контакт по любым вопросам о ваших данных — владелица закрытой группы. Напишите ей в Telegram.</p>
<p>Бот обрабатывает ваши данные на основании вашего согласия, которое вы дали, вступив в группу. Если вы больше не согласны, выйдите из группы.</p>
<h2>Что бот знает о вас и зачем</h2>
<p>Боту нужно только то, что требуется, чтобы собрать репорт:</p>
<ul>
<li><strong>Ваш Telegram ID</strong>: чтобы проверить, что вы в группе, и запомнить выбранный телефон.</li>
<li><strong>Присланное вами местоположение</strong>: чтобы найти адрес и проверить, что машина в районе.</li>
<li><strong>Номер машины</strong>, прочитанный с фото или написанный вами, а также адрес, тип нарушения, дата и время репорта.</li>
<li><strong>Адреса, которые вы пишете или добавляете сами</strong>, вместе с вашим Telegram ID, пока админ не примет решение.</li>
<li><strong>Ваш отзыв и запросы на приглашение</strong>, если вы пользуетесь /feedback или /invite.</li>
</ul>
<p>Само фото бот не сохраняет: он читает его в памяти и сразу забывает. Номера машин и люди на фото считаются персональными данными, поэтому бот фото не хранит: они остаются в вашем чате с ботом.</p>
<h2>Чего бот не получает</h2>
<p>Ваши имя, фамилия, телефон, email и домашний адрес не попадают ни к боту, ни на его сервер. Они хранятся только в закладке на вашем телефоне, и скрипт закладки подставляет их в форму Traffic Watch прямо там. Часть ссылки репорта после знака # не уходит даже на сервер Traffic Watch, а скрипт убирает ее из адресной строки сразу после прочтения.</p>
<h2>Кто еще что-то видит</h2>
<p>Боту помогают несколько сервисов, и каждый видит часть данных:</p>
<ul>
<li><strong>Telegram</strong> передает все ваши сообщения и фото и хранит их в вашем чате на своих серверах.</li>
<li><strong>Cloudflare</strong> держит бота и его базу данных. Ваше фото уходит в Workers AI от Cloudflare только затем, чтобы прочитать номер; результат хранится 24 часа, чтобы одно и то же фото не читали дважды.</li>
<li><strong>OpenStreetMap (Nominatim)</strong> получает координаты, когда в пределах 30 м от вашего местоположения у бота нет своего адреса.</li>
<li><strong>Mapbox</strong> показывает карты на веб-страницах бота, поэтому ваш браузер обращается к Mapbox, когда вы открываете карту.</li>
<li><strong>Сервер бота</strong> отвечает, когда закладка загружает файл скрипта, поэтому видит адрес запроса и ваш IP-адрес, как любой сайт. Скрипт выполняется на странице Traffic Watch при каждом запуске закладки, то есть вы доверяете тому, кто делает бота.</li>
</ul>
<p>Бот сам репорты не отправляет: вы отправляете их сами из формы Traffic Watch. Админы группы видят только то, что показывает им бот: адреса на одобрении, отзывы, запросы на вступление с именами, списки номеров, на которые жалуются часто или которые, возможно, брошены, и карту мест и дат репортов.</p>
<h2>Как долго хранятся данные</h2>
<p>Бот чистит данные сам, два раза в сутки.</p>
<table>
<tr><th>Что</th><th>Как долго</th></tr>
<tr><td>Черновик репорта, который вы делаете</td><td>24 часа</td></tr>
<tr><td>Текст итогового сообщения (номер, адрес, дата), чтобы работали кнопки Done и Cancel</td><td>пока вы не нажмете Done или Cancel, но не дольше 48 часов</td></tr>
<tr><td>Результат чтения фото</td><td>24 часа</td></tr>
<tr><td>Журнал репортов: номер, дата, тип нарушения, адрес и координаты места (без Telegram ID)</td><td>66 дней</td></tr>
<tr><td>Ваш Telegram ID с датой последнего использования бота, выбранный телефон и счетчик ссылок</td><td>2 месяца после последнего использования</td></tr>
<tr><td>Отзыв, который вы написали, с вашим Telegram ID</td><td>2 месяца</td></tr>
<tr><td>Ссылка-приглашение, которую вы создали</td><td>7 дней</td></tr>
<tr><td>Запросы на вступление: кто кого пригласил и решение</td><td>2 месяца</td></tr>
<tr><td>Адрес, который вы написали или добавили, с вашим Telegram ID, пока он ждет админа</td><td>до решения админа, но не дольше 2 месяцев; ваш Telegram ID стирается, когда решение принято</td></tr>
<tr><td>Одобренные адреса на карте</td><td>пока админ их не удалит</td></tr>
<tr><td>Ежедневные числа без имен и номеров (сколько ссылок, какие типы нарушений)</td><td>без срока</td></tr>
</table>
<p>Фото бот не хранит вообще. Они остаются в вашем чате с ботом, пока вы сами их там не удалите.</p>
<h2>Ваши права</h2>
<p>Чтобы удалить ваши данные из базы данных бота, отправьте боту /forget_me: он удалит данные и удалит вас из группы, поскольку группа используется для доступа к боту. Вы можете снова вернуться в группу по приглашению.</p>
<p>Вы можете в любой момент перестать пользоваться ботом: выйдите из группы. В течение часа бот перестанет вам отвечать; кнопки, которые уже есть в вашем чате, могут еще какое-то время работать.</p>
<h2>Изменения в этом тексте</h2>
<p>Если бот начнет обращаться с данными по-новому, сначала обновится этот текст.</p>`;

// Static page.
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>StreetBuddy Privacy Policy</title>
<style>
${BASE_STYLE}
${TABLE_STYLE}
</style>
</head>
<body>
<main>
<p class="choice"><button type="button" aria-pressed="true" data-lang="en">English</button><button type="button" aria-pressed="false" data-lang="ru">Russian</button></p>
<div lang="en" data-lang-section="en">
<h1>StreetBuddy Privacy Policy</h1>
${POLICY_EN}
</div>
<div lang="ru" data-lang-section="ru" hidden>
<h1>Политика конфиденциальности StreetBuddy</h1>
${POLICY_RU}
</div>
</main>
<script>
${PAGE_SCRIPT}
</script>
</body>
</html>
`;

export function privacyPage(): Response {
  return htmlResponse(PAGE);
}
