#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Ejecutá este script como root (sudo ./install.sh)" >&2
  exit 1
fi

install -m 755 "$SCRIPT_DIR/sudo_watch.py" /usr/local/bin/sudo_watch.py

mkdir -p /etc/sudo-watch
if [[ ! -f /etc/sudo-watch/config.env ]]; then
  install -m 600 "$SCRIPT_DIR/config.env.example" /etc/sudo-watch/config.env
  echo "Se creó /etc/sudo-watch/config.env. Editalo (sobre todo NTFY_TOPIC) antes de continuar."
fi

install -m 644 "$SCRIPT_DIR/sudo-watch.service" /etc/systemd/system/sudo-watch.service

systemctl daemon-reload
systemctl enable --now sudo-watch.service

echo "Listo. Ver logs con: journalctl -u sudo-watch -f"
