# sudo-watch

Envía una notificación push al celular cada vez que uno de los usuarios
vigilados (`cristian`, `margarita`, `adrian`) ejecuta un comando con `sudo`
en el servidor Ubuntu, incluyendo el comando ejecutado.

No requiere desarrollar una app propia: usa [ntfy](https://ntfy.sh), una app
gratuita y open-source (Android/iOS) que recibe notificaciones vía HTTP.

## 1. App en el celular

1. Instalá **ntfy** desde Play Store / F-Droid (Android) o App Store (iOS).
2. Elegí un nombre de "topic" largo y aleatorio (no algo adivinable), por
   ejemplo generalo con `openssl rand -hex 16`.
3. En la app, tocá "+" y suscribite a ese topic (servidor `ntfy.sh` por
   defecto, o el tuyo propio si self-hosteás ntfy).

## 2. Servidor Ubuntu

1. Copiá esta carpeta al servidor.
2. Editá `config.env.example`, poné el mismo `NTFY_TOPIC` que usaste en el
   celular, y confirmá la lista de `WATCHED_USERS`.
3. Instalá:

   ```bash
   sudo ./install.sh
   ```

   Esto copia el script a `/usr/local/bin/sudo_watch.py`, la configuración a
   `/etc/sudo-watch/config.env` y registra el servicio systemd
   `sudo-watch`, que queda corriendo y arrancando en cada boot.

4. Probá: hacé que uno de los usuarios vigilados corra cualquier comando con
   `sudo` (por ejemplo `sudo whoami`) y deberías recibir la notificación en
   el celular en segundos.

## Cómo funciona

El script sigue el journal de systemd filtrando por `sudo` (equivalente a
tailear `/var/log/auth.log`), parsea cada línea para extraer el usuario y el
`COMMAND=`, y si el usuario está en `WATCHED_USERS` hace un POST a
`https://ntfy.sh/<tu-topic>` con el comando ejecutado.

## Administración

- Ver logs: `journalctl -u sudo-watch -f`
- Reiniciar tras editar la config: `sudo systemctl restart sudo-watch`
- Agregar/quitar usuarios: editá `WATCHED_USERS` en
  `/etc/sudo-watch/config.env` y reiniciá el servicio.

## Seguridad

- Cualquiera que conozca tu `NTFY_TOPIC` en `ntfy.sh` puede leer (y publicar)
  en ese topic. Usá un nombre largo y aleatorio, o self-hosteá tu propio
  servidor ntfy con autenticación (`NTFY_BASIC_USER` / `NTFY_BASIC_PASS`).
- El servicio corre como `root` porque necesita leer el journal completo del
  sistema (los eventos de `sudo` de otros usuarios).
