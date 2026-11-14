#!/bin/sh
# Prepara o usuário mordomo e /srv/jarvis-voz (Jarvis de voz). Roda no servidor como root. Idempotente.
# O login do Claude Code no mordomo é feito uma vez à mão: sudo -u mordomo -H /home/mordomo/.local/bin/claude → /login
set -eu
A=/srv/jarvis-previas/app/voz
V=/srv/jarvis-voz
id mordomo >/dev/null 2>&1 || useradd -m -s /bin/bash mordomo
install -d -o lorenzo -g lorenzo -m 755 $V
install -d -o mordomo -g mordomo -m 755 $V/sessao $V/estado
install -d -o root -g mordomo -m 750 $V/bin
install -d -o root -g root -m 755 $V/hooks
[ -f $V/acoes.log ] || install -o lorenzo -g lorenzo -m 644 /dev/null $V/acoes.log
install -m 755 $A/hooks/ao-parar $V/hooks/ao-parar
install -o mordomo -g mordomo -m 644 $A/sessao/CLAUDE.md $V/sessao/CLAUDE.md
[ -x /home/mordomo/.local/bin/claude ] || sudo -u mordomo -H sh -c 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null
install -d -o mordomo -g mordomo -m 700 /home/mordomo/.claude
install -o mordomo -g mordomo -m 644 $A/claude-settings.json /home/mordomo/.claude/settings.json
sudo -u mordomo -H python3 - <<'PY'
import json, os
p = os.path.expanduser("~/.claude.json")
d = json.load(open(p)) if os.path.exists(p) else {}
d.setdefault("projects", {}).setdefault("/srv/jarvis-voz/sessao", {})["hasTrustDialogAccepted"] = True
json.dump(d, open(p, "w"), indent=2)
PY
sudo -u mordomo -H /home/mordomo/.local/bin/claude plugin marketplace add /srv/habblaud >/dev/null 2>&1 || true
for p in habblaud habblaud-permissoes habblaud-mensagens; do
  sudo -u mordomo -H /home/mordomo/.local/bin/claude plugin install "$p@habblaud" >/dev/null 2>&1 || true
done
echo "voz: ok"
