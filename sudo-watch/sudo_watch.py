#!/usr/bin/env python3
"""Vigila el journal en busca de invocaciones de sudo y avisa por ntfy."""
import base64
import json
import os
import re
import socket
import subprocess
import sys
import urllib.request

SUDO_LINE_RE = re.compile(
    r'^(?P<user>[\w.\-]+)\s*:\s*.*COMMAND=(?P<command>.+)$'
)


def load_config():
    ntfy_url = os.environ.get("NTFY_URL", "https://ntfy.sh").rstrip("/")
    topic = os.environ.get("NTFY_TOPIC")
    if not topic:
        sys.exit("NTFY_TOPIC no está configurado (ver config.env)")
    users_raw = os.environ.get("WATCHED_USERS", "")
    users = {u.strip() for u in users_raw.split(",") if u.strip()}
    if not users:
        sys.exit("WATCHED_USERS está vacío (ver config.env)")
    auth_user = os.environ.get("NTFY_BASIC_USER")
    auth_pass = os.environ.get("NTFY_BASIC_PASS")
    return ntfy_url, topic, users, auth_user, auth_pass


def send_notification(ntfy_url, topic, auth_user, auth_pass, user, command):
    hostname = socket.gethostname()
    message = f"{user}@{hostname} ejecutó:\n{command}"
    req = urllib.request.Request(
        f"{ntfy_url}/{topic}",
        data=message.encode("utf-8"),
        method="POST",
        headers={
            "Title": f"sudo por {user} en {hostname}",
            "Priority": "high",
            "Tags": "warning,rotating_light",
        },
    )
    if auth_user and auth_pass:
        creds = base64.b64encode(f"{auth_user}:{auth_pass}".encode()).decode()
        req.add_header("Authorization", f"Basic {creds}")
    try:
        urllib.request.urlopen(req, timeout=10)
    except Exception as exc:  # noqa: BLE001 - queremos loguear cualquier falla de red
        print(f"[sudo-watch] error enviando notificación: {exc}", file=sys.stderr)


def main():
    ntfy_url, topic, users, auth_user, auth_pass = load_config()
    print(f"[sudo-watch] vigilando sudo para: {', '.join(sorted(users))}")

    proc = subprocess.Popen(
        ["journalctl", "-f", "-t", "sudo", "-o", "json", "--since=now"],
        stdout=subprocess.PIPE,
        text=True,
        bufsize=1,
    )
    assert proc.stdout is not None

    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        message = entry.get("MESSAGE", "")
        match = SUDO_LINE_RE.match(message)
        if not match:
            continue

        user = match.group("user")
        if user not in users:
            continue

        command = match.group("command").strip()
        print(f"[sudo-watch] {user} -> {command}")
        send_notification(ntfy_url, topic, auth_user, auth_pass, user, command)


if __name__ == "__main__":
    main()
