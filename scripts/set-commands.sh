#!/bin/sh
# Sets the list of commands under the "Menu" button of the bot (setMyCommands), once for all
# private chats. /start and /admin are not in the list.
#
# Usage: BOT_TOKEN=... scripts/set-commands.sh
set -e

if [ -z "$BOT_TOKEN" ]; then
  echo "BOT_TOKEN is needed" >&2
  exit 1
fi

commands='[{"command":"manual","description":"User manual"},{"command":"setup","description":"Setup guide"},{"command":"hotspots","description":"Hotspots"},{"command":"map","description":"Area map"},{"command":"feedback","description":"Feedback"},{"command":"phone","description":"Phone"},{"command":"add_address","description":"Add address"}]'
resp=$(curl -sS "https://api.telegram.org/bot$BOT_TOKEN/setMyCommands" \
  --data-urlencode "commands=$commands" \
  --data-urlencode 'scope={"type":"all_private_chats"}')

echo "$resp" | grep -q '"ok":true' || { echo "setMyCommands failed: $resp" >&2; exit 1; }
echo "$resp"
