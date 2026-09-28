# Estado de IPs

Web app mobile-first que muestra el estado **ACTIVO** / **INACTIVO** de una lista de direcciones IP, pensada para consultarse desde el celular en la misma red.

## Cómo funciona

- Un servidor Node.js (Express) chequea cada IP:
  1. Intenta un **ping ICMP** (comando `ping` del sistema).
  2. Si el ping falla o no está disponible (permisos, ICMP bloqueado), hace un **fallback por TCP** intentando conectar a puertos comunes (80, 443, 22, 8080, 3389, 21, 23, 445). Si alguno responde o rechaza la conexión, el host se considera activo.
- El frontend consulta el estado cada 8 segundos y se puede refrescar manualmente.
- La lista de IPs se guarda en `data/ips.txt`, un archivo de texto plano, y se puede editar tanto a mano como desde la misma web (agregar / eliminar), salvo que se desactive con `ALLOW_IP_EDITS` (ver más abajo). Cada IP muestra en el front su nombre nemotécnico en lugar de la dirección cruda.
- Si una IP pasa de ACTIVO a INACTIVO, suena una alarma sonora en bucle hasta que se silencia manualmente. Se puede desactivar por completo con el botón 🔔/🔕 (la preferencia queda guardada en el navegador).
- El acceso a toda la app (front y API) requiere iniciar sesión con un **usuario y contraseña del propio sistema operativo (Ubuntu/Linux)**, validados vía PAM — no hay usuarios propios de la app.

## Requisitos

- Node.js 18+
- El comando `ping` instalado en el sistema donde corra el servidor (recomendado, mejora la precisión). Si no está disponible, la app igual funciona usando el fallback por TCP.
- Para compilar la dependencia de autenticación (`authenticate-pam`, un módulo nativo) hacen falta las cabeceras de PAM y herramientas de compilación:
  ```bash
  sudo apt-get install libpam0g-dev build-essential python3
  ```

## Instalación y uso

```bash
npm install
npm start
```

Por defecto el servidor escucha en el puerto `3000` en todas las interfaces (`0.0.0.0`), lo que permite acceder desde el celular.

## Seguridad y acceso

Para entrar a la app hay que loguearse con un **usuario y contraseña válidos de Ubuntu** (los mismos con los que se hace login en esa máquina o por SSH). El navegador va a pedir usuario y contraseña la primera vez (HTTP Basic Auth); el servidor valida esas credenciales contra el sistema mediante **PAM** (`pam_authenticate`, servicio `login` por defecto), no las guarda en ningún lado.

Variables de entorno disponibles:

- `PAM_SERVICE_NAME` (default `login`): nombre del servicio PAM a usar (los definidos en `/etc/pam.d/`). Se puede crear uno propio para esta app si se quiere una política de autenticación distinta a la del login normal.
- `PAM_ALLOWED_USERS`: lista opcional de usuarios del sistema separados por coma (ej: `PAM_ALLOWED_USERS=operador,juan`) que restringe el ingreso a esos usuarios puntuales, aunque otros tengan contraseña válida. Si no se define, cualquier usuario del sistema con contraseña válida puede entrar.

```bash
PAM_ALLOWED_USERS=operador npm start
```

**Recomendaciones importantes:**
- No uses la cuenta `root` ni tu usuario personal para esto. Creá un usuario Ubuntu dedicado sólo para acceder a la app (por ejemplo `useradd -m ipstatus && passwd ipstatus`) y restringilo con `PAM_ALLOWED_USERS`, así una eventual filtración no compromete otras cuentas del servidor.
- Ya hay una protección básica contra fuerza bruta: tras 5 intentos fallidos seguidos desde la misma IP, esa IP queda bloqueada 15 minutos (además del retardo que PAM ya aplica en cada intento fallido).
- **Importante si vas a exponer la app fuera de la intranet** (puerto reenviado desde el router, VPS, túnel, etc.): HTTP Basic Auth por sí solo **no cifra el tráfico**, así que la contraseña de un usuario real de Ubuntu viajaría expuesta si el acceso no pasa por HTTPS. Para eso, poné la app detrás de un proxy con TLS en lugar de exponer el puerto `3000` directo a internet. Opciones simples:
  - Un proxy inverso con certificado automático, por ejemplo [Caddy](https://caddyserver.com/) (`reverse_proxy localhost:3000` + tu dominio) o Nginx + Let's Encrypt.
  - Una VPN/túnel privado como [Tailscale](https://tailscale.com/) o [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), que evitan abrir puertos públicos.
- No hace falta correr el proceso como `root`: en Ubuntu, la verificación de contraseña se delega al helper `unix_chkpwd` (con permisos elevados propios), así que un usuario sin privilegios puede ejecutar el servidor igual.

## Acceso desde el celular

1. Corré el servidor en una computadora conectada a la misma red Wi-Fi que el celular.
2. Buscá la IP local de esa computadora (ejemplo en Linux/Mac: `hostname -I` o `ifconfig`; en Windows: `ipconfig`).
3. Desde el navegador del celular, entrá a `http://<IP-de-la-computadora>:3000` (por ejemplo `http://192.168.1.50:3000`) e ingresá un usuario y contraseña válidos de esa máquina Ubuntu cuando lo pida.
4. Opcional: agregá la página a la pantalla de inicio del celular para acceder como si fuera una app.

Para cambiar el puerto: `PORT=8080 npm start`.

## Configurar la lista de IPs

La lista vive en `data/ips.txt`, un archivo de texto con una IP por línea en el formato:

```
<ip> <nombre nemotécnico>
```

Por ejemplo:

```
# Lista de IPs a monitorear
192.168.1.1 Router
8.8.8.8 Google DNS
192.168.1.20 Camara Entrada
```

- Las líneas vacías o que empiezan con `#` se ignoran.
- El nombre nemotécnico es lo que se muestra en el front (no la IP cruda).
- También se puede editar desde la web (formulario "Agregar" y botón ✕ para eliminar). Nota: guardar desde la web reescribe el archivo completo, por lo que se conserva el encabezado de comentario estándar pero se pierde cualquier comentario adicional que se haya agregado a mano.

### Modo de solo lectura

Para ocultar (y bloquear también del lado del servidor) la posibilidad de agregar o eliminar IPs desde la web, iniciá el servidor con:

```bash
ALLOW_IP_EDITS=false npm start
```

Con esto el formulario "Agregar" y el botón ✕ no se muestran, y los endpoints `POST /api/ips` y `DELETE /api/ips/:ip` responden `403` aunque se los llame directamente. Sigue funcionando la consulta de estado; la lista sólo se puede modificar editando `data/ips.txt` a mano. Por defecto (`ALLOW_IP_EDITS` sin definir, o `true`) la edición está permitida.

## Alarma de caída (online → offline)

Cuando el front detecta que una IP pasó de ACTIVO a INACTIVO entre dos actualizaciones, dispara una alarma sonora (beep) que se repite cada 1.2 segundos hasta que se silencia — no se detiene sola.

- **Silenciar la alarma que está sonando**: botón "Silenciar" en el banner rojo que aparece arriba de la lista.
- **Desactivar la alarma por completo** (para que no vuelva a sonar): botón 🔔 junto al de refrescar, en la barra superior. Pasa a 🔕 y la preferencia se guarda en el navegador (`localStorage`), por lo que persiste entre visitas en ese mismo dispositivo.
- No suena al cargar la página por primera vez, sólo ante una transición detectada en vivo (evita falsas alarmas si abrís la app y ya había algo caído).
- Requiere que el navegador haya tenido alguna interacción del usuario en la página (por políticas de autoplay); alcanza con el primer toque en la pantalla.
