#!/bin/sh
# Cria ou troca o login do sistema: sh scripts/create-login.sh USUARIO
# Depois rode: docker compose restart web
set -eu
user="${1:?Uso: sh scripts/create-login.sh USUARIO}"
case "$user" in *:*) echo 'O usuário não pode ter ":".' >&2; exit 1 ;; esac
printf 'Senha: ' >&2
stty -echo 2>/dev/null || true
IFS= read -r password
stty echo 2>/dev/null || true
printf '\n' >&2
[ "${#password}" -ge 12 ] || { echo 'Use pelo menos 12 caracteres.' >&2; exit 1; }
hash="$(printf '%s\n' "$password" | openssl passwd -5 -stdin)"
cd "$(dirname "$0")/.."
printf '%s:%s\n' "$user" "$hash" > .htpasswd
chmod 644 .htpasswd # o nginx do container precisa ler; o arquivo só tem o hash
echo 'Login salvo em .htpasswd.' >&2
