#!/usr/bin/env bash
# Deploy contínuo caseiro: puxa o main do GitHub e rebuilda os containers
# QUANDO (e só quando) há commit novo. Pensado pra rodar via cron no ZimaOS —
# assim toda atualização mesclada no main entra em produção sozinha.
#
# Instalação (uma vez, no Zima):
#   chmod +x scripts/auto-update.sh
#   crontab -e   # e adicione a linha (ajuste o caminho do clone):
#   */10 * * * * /DATA/Captacao/scripts/auto-update.sh >> /DATA/Captacao/update.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

# Lock: se uma atualização ainda está rebuildando, a próxima rodada do cron
# desiste em silêncio em vez de empilhar builds.
exec 9>/tmp/captacao-update.lock
flock -n 9 || exit 0

git fetch origin main --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0   # nada novo — sai sem logar nada

echo "[$(date '+%F %T')] novo commit no main: ${LOCAL:0:7} -> ${REMOTE:0:7} — atualizando…"
# reset --hard (não pull): imune a histórico reescrito e a qualquer edição
# local acidental — o clone do servidor é só um espelho do GitHub.
git reset --hard origin/main --quiet
docker compose up -d --build
echo "[$(date '+%F %T')] atualizado e no ar."
