#!/bin/bash
# Cron mensal no servidor: atualiza os comércios do Overture e avisa o Lorenzo no WhatsApp (pelo bot).
# Instalação: copiar para ~/atualizar_overture.sh junto com ~/import_overture.py e o venv ~/overture-venv.
set -o pipefail
LOG="$HOME/overture-import.log"
echo "=== $(date '+%F %T')" >> "$LOG"

if "$HOME/overture-venv/bin/python" -I "$HOME/import_overture.py" 2>>"$LOG" \
  | docker exec -i postgres-db psql -U lorenzo -d captacao -q -v ON_ERROR_STOP=1 >>"$LOG" 2>&1; then
  n=$(docker exec postgres-db psql -U lorenzo -d captacao -At -c "SELECT count(*) FROM osm_places WHERE id LIKE 'overture/%'")
  versao=$(grep -o 'Overture [0-9.-]*' "$LOG" | tail -1)
  msg="✅ Leads atualizados (${versao}): ${n} comércios do RS no banco."
else
  msg="❌ A atualização mensal dos leads (Overture) falhou. Os dados antigos continuam valendo. Final do log:
$(tail -5 "$LOG")"
fi

# Mesmo canal dos avisos do bot (OWNER_WHATSAPP); o envio fica dentro do Captação.
printf '%s' "$msg" | docker exec -i captacao-api-1 node --input-type=module -e '
import { createGateway } from "/app/server/src/bot/gateway.js";
let texto = "";
for await (const parte of process.stdin) texto += parte;
await createGateway().send(process.env.OWNER_WHATSAPP, "🤖 " + texto);
' >>"$LOG" 2>&1 || echo "aviso no WhatsApp não enviado" >> "$LOG"
