#!/bin/sh
# Roda no servidor, como root (o install.sh chama). Idempotente.
set -eu
A=/srv/jarvis-previas/app
[ -f /srv/jarvis-previas/config/config.json ] || { echo "falta /srv/jarvis-previas/config/config.json (token, captacaoUrl, captacaoAuth, porta)"; exit 1; }
chown -R lorenzo:lorenzo $A /srv/jarvis-previas/data /srv/jarvis-previas/config
chmod -R go-w $A
chmod 700 /srv/jarvis-previas/data /srv/jarvis-previas/config
chmod 600 /srv/jarvis-previas/config/config.json
install -d -m 755 /etc/claude-code
install -m 644 -o root $A/deploy/managed-settings.json /etc/claude-code/managed-settings.json
visudo -cf $A/deploy/sudoers
install -m 440 -o root $A/deploy/sudoers /etc/sudoers.d/jarvis-previas
# A pasta-mãe dos pedidos é confiável para o Claude do previas (as subpastas não perguntam).
sudo -u previas python3 - <<'PY'
import json
p = "/home/previas/.claude.json"
d = json.load(open(p))
d.setdefault("projects", {}).setdefault("/srv/jarvis-previas/jobs", {})["hasTrustDialogAccepted"] = True
json.dump(d, open(p, "w"), indent=2)
PY
install -m 644 $A/deploy/habblaud.service $A/deploy/jarvis-previas.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now habblaud jarvis-previas >/dev/null 2>&1
systemctl restart jarvis-previas
tailscale serve --bg --https=8095 http://127.0.0.1:8095 >/dev/null
tailscale serve --bg --https=4747 https+insecure://127.0.0.1:4748 >/dev/null
systemctl is-active habblaud jarvis-previas
