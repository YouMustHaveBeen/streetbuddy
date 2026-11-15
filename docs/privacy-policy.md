# StreetBuddy privacy policy (draft)

Draft text, not yet published. Still open: the wording of the legal basis and the DPIA (see docs/architecture.md п.58).

## English

### Who runs StreetBuddy

StreetBuddy is run by one of your neighbours, not by a company. It helps people in the area prepare Traffic Watch reports about illegal parking, and only members of the closed Street Buddy Group can use it. The bot is not connected to An Garda Síochána.

If you have a question, or want your data deleted, write to the admins with /feedback in the bot.

### What the bot knows about you, and why

The bot only needs what it takes to put a report together:

- **Your Telegram ID**, to check that you are in the group and to keep your phone choice.
- **The location you send**, to find the address and to check that the car is in the area.
- **The plate number**, read from your photo or typed by you, and the address, the type of violation, the date and the time of the report.
- **Addresses you type or add yourself**, with your Telegram ID, until an admin decides on them.
- **Your feedback and your invite requests**, if you use /feedback or /invite.

The photo itself is not saved by the bot. It is read in memory and dropped. Plate numbers and people in photos count as personal data, so the bot does not keep photos: they stay in your own chat with the bot.

### What the bot does not get

Your name, surname, phone, email and home address never reach the bot or its server. They are stored only in the bookmark on your phone, and the bookmark script fills them into the Traffic Watch form there. The part of the report link after the # does not even go to the Traffic Watch server, and the script removes it from the address bar as soon as it has read it.

### Who else sees something

A few services help the bot work, and each of them sees a part of the data:

- **Telegram** carries all your messages and photos, and keeps them in your chat on its servers.
- **Cloudflare** hosts the bot and its database. Your photo is sent to Cloudflare's Workers AI only to read the plate, and the result is kept for 24 hours so the same photo is not read twice.
- **OpenStreetMap (Nominatim)** gets the coordinates when the bot has no address of its own within 30 m of your location.
- **Mapbox** shows the maps on the bot's web pages, so your browser talks to Mapbox when you open a map.
- **The bot's server** answers when your bookmark loads the script file, so it sees the request address and your IP address, like any website. The script runs on the Traffic Watch page every time you use the bookmark, so you are trusting whoever runs the bot with that.

The bot never sends a report. You send it yourself from the Traffic Watch form, and the admins of the group see only what the bot shows them: addresses waiting for approval, feedback, and invite requests with names.

### How long things are kept

The bot cleans up by itself, twice a day.

| What | How long |
| --- | --- |
| Draft of the report you are making | 24 hours |
| Text of the final message (plate, address, date), to keep the Done and Cancel buttons working | until you tap Done or Cancel, at most 48 hours |
| Result of reading a photo | 24 hours |
| Report log: plate, date, type of violation, address (no Telegram ID) | 66 days |
| Your Telegram ID with the date you last used the bot, your phone choice and link counter | 2 months after the last use |
| Feedback you wrote, with your Telegram ID | 2 months |
| Invite link you made | 7 days |
| Join requests: who invited whom and the decision | 2 months |
| An address you typed or added, with your Telegram ID, while waiting for an admin | until the admin decides, at most 2 months; your Telegram ID is erased once it is decided |
| Approved addresses on the map | until an admin deletes them |
| Daily counts with no names or plates (how many links, which violation types) | no limit |

Photos are not stored by the bot at all. They stay in your own chat with the bot until you delete them there.

### Your rights

You can ask what the bot has about you, ask for a correction, or ask for your data to be deleted. Write to the admins with /feedback and say what you want. Since the bot keeps data for weeks, not years, most of it will be gone on its own soon anyway.

You can also stop at any time: leave the group and the bot stops answering you.

### Changes to this text

If the bot starts handling data in a new way, this text is updated first.

## Русский

### Кто делает StreetBuddy

StreetBuddy делает один из ваших соседей, а не компания. Бот помогает подготовить репорты Traffic Watch о неправильной парковке, и пользоваться им могут только участники закрытой группы Street Buddy Group. К Garda бот отношения не имеет.

Если у вас есть вопрос или вы хотите, чтобы ваши данные удалили, напишите админам через /feedback в боте.

### Что бот знает о вас и зачем

Боту нужно только то, что требуется, чтобы собрать репорт:

- **Ваш Telegram ID**: чтобы проверить, что вы в группе, и запомнить выбранный телефон.
- **Присланное вами местоположение**: чтобы найти адрес и проверить, что машина в районе.
- **Номер машины**, прочитанный с фото или написанный вами, а также адрес, тип нарушения, дата и время репорта.
- **Адреса, которые вы пишете или добавляете сами**, вместе с вашим Telegram ID, пока админ не примет решение.
- **Ваш отзыв и запросы на приглашение**, если вы пользуетесь /feedback или /invite.

Само фото бот не сохраняет: он читает его в памяти и сразу забывает. Номера машин и люди на фото считаются персональными данными, поэтому бот фото не хранит: они остаются в вашем чате с ботом.

### Чего бот не получает

Ваши имя, фамилия, телефон, email и домашний адрес не попадают ни к боту, ни на его сервер. Они хранятся только в закладке на вашем телефоне, и скрипт закладки подставляет их в форму Traffic Watch прямо там. Часть ссылки репорта после знака # не уходит даже на сервер Traffic Watch, а скрипт убирает ее из адресной строки сразу после прочтения.

### Кто еще что-то видит

Боту помогают несколько сервисов, и каждый видит часть данных:

- **Telegram** передает все ваши сообщения и фото и хранит их в вашем чате на своих серверах.
- **Cloudflare** держит бота и его базу данных. Ваше фото уходит в Workers AI от Cloudflare только затем, чтобы прочитать номер; результат хранится 24 часа, чтобы одно и то же фото не читали дважды.
- **OpenStreetMap (Nominatim)** получает координаты, когда в пределах 30 м от вашего местоположения у бота нет своего адреса.
- **Mapbox** показывает карты на веб-страницах бота, поэтому ваш браузер обращается к Mapbox, когда вы открываете карту.
- **Сервер бота** отвечает, когда закладка загружает файл скрипта, поэтому видит адрес запроса и ваш IP-адрес, как любой сайт. Скрипт выполняется на странице Traffic Watch при каждом запуске закладки, то есть вы доверяете тому, кто делает бота.

Бот сам репорты не отправляет: вы отправляете их сами из формы Traffic Watch. Админы группы видят только то, что показывает им бот: адреса на одобрении, отзывы и запросы на вступление с именами.

### Как долго хранятся данные

Бот чистит данные сам, два раза в сутки.

| Что | Как долго |
| --- | --- |
| Черновик репорта, который вы делаете | 24 часа |
| Текст итогового сообщения (номер, адрес, дата), чтобы работали кнопки Done и Cancel | пока вы не нажмете Done или Cancel, но не дольше 48 часов |
| Результат чтения фото | 24 часа |
| Журнал репортов: номер, дата, тип нарушения, адрес (без Telegram ID) | 66 дней |
| Ваш Telegram ID с датой последнего использования бота, выбранный телефон и счетчик ссылок | 2 месяца после последнего использования |
| Отзыв, который вы написали, с вашим Telegram ID | 2 месяца |
| Ссылка-приглашение, которую вы создали | 7 дней |
| Запросы на вступление: кто кого пригласил и решение | 2 месяца |
| Адрес, который вы написали или добавили, с вашим Telegram ID, пока он ждет админа | до решения админа, но не дольше 2 месяцев; ваш Telegram ID стирается, когда решение принято |
| Одобренные адреса на карте | пока админ их не удалит |
| Ежедневные числа без имен и номеров (сколько ссылок, какие типы нарушений) | без срока |

Фото бот не хранит вообще. Они остаются в вашем чате с ботом, пока вы сами их там не удалите.

### Ваши права

Вы можете спросить, что бот о вас знает, попросить исправить данные или удалить их. Напишите админам через /feedback и скажите, что вам нужно. Бот хранит данные неделями, а не годами, поэтому большая часть и так скоро исчезнет сама.

Вы также можете в любой момент перестать пользоваться ботом: выйдите из группы, и бот перестанет вам отвечать.

### Изменения в этом тексте

Если бот начнет обращаться с данными по-новому, сначала обновится этот текст.
