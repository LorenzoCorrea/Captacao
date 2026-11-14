#!/bin/sh
# Instala o jarvis-previas no servidor a partir do notebook: ./jarvis-previas/deploy/install.sh
set -eu
cd "$(dirname "$0")/.."
rsync -a --delete --exclude test --exclude node_modules ./ servidor:/srv/jarvis-previas/app/
ssh -t servidor sudo sh /srv/jarvis-previas/app/deploy/install-remote.sh
