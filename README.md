# Estado de IPs

Web app mobile-first que muestra el estado **ACTIVO** / **INACTIVO** de una lista de direcciones IP, pensada para consultarse desde el celular en la misma red.

## Cómo funciona

- Un servidor Node.js (Express) chequea cada IP:
  1. Intenta un **ping ICMP** (comando `ping` del sistema).
  2. Si el ping falla o no está disponible (permisos, ICMP bloqueado), hace un **fallback por TCP** intentando conectar a puertos comunes (80, 443, 22, 8080, 3389, 21, 23, 445). Si alguno responde o rechaza la conexión, el host se considera activo.
- El frontend consulta el estado cada 8 segundos y se puede refrescar manualmente.
- La lista de IPs se guarda en `data/ips.txt`, un archivo de texto plano, y se puede editar tanto a mano como desde la misma web (agregar / eliminar), salvo que se desactive con `ALLOW_IP_EDITS` (ver más abajo). Cada IP muestra en el front su nombre nemotécnico en lugar de la dirección cruda.
- Si una IP pasa de ACTIVO a INACTIVO, suena una alarma sonora en bucle hasta que se silencia manualmente. Se puede desactivar por completo con el botón 🔔/🔕 (la preferencia queda guardada en el navegador).
- El acceso a toda la app (front y API) requiere iniciar sesión con un usuario y contraseña propios de la app, guardados en un **archivo de texto** (`data/users.txt`) con la contraseña **hasheada con Argon2id** — nunca en texto plano.

## Requisitos

- Node.js 18+
- El comando `ping` instalado en el sistema donde corra el servidor (recomendado, mejora la precisión). Si no está disponible, la app igual funciona usando el fallback por TCP.

## Instalación y uso

```bash
npm install
npm start
```

Por defecto el servidor escucha en el puerto `3000` en todas las interfaces (`0.0.0.0`), lo que permite acceder desde el celular.

Antes de poder entrar hay que crear al menos un usuario (ver siguiente sección) — si `data/users.txt` no existe o está vacío, el servidor arranca pero nadie puede loguearse, y lo avisa por consola.

## Seguridad y acceso

Las credenciales viven en `data/users.txt`, un archivo de texto plano con una línea por usuario:

```
usuario:hash-argon2id-de-la-contraseña
```

El usuario queda en texto plano, pero la contraseña **nunca se guarda en claro**: se guarda su hash **Argon2id** (el algoritmo recomendado actualmente para hashear contraseñas). Al loguearse por HTTP Basic Auth, el servidor busca el usuario en ese archivo y verifica la contraseña contra el hash con `argon2.verify()`.

### Gestionar usuarios

Se gestionan con un script de línea de comandos (pide la contraseña de forma oculta, nunca queda en el historial de la terminal):

```bash
node scripts/manage-users.js add <usuario>       # crea o actualiza un usuario (pide la contraseña)
node scripts/manage-users.js remove <usuario>    # elimina un usuario
node scripts/manage-users.js list                # lista los usuarios (sin mostrar hashes)
```

También corre como `npm run users -- add <usuario>`. Los cambios aplican al toque, sin reiniciar el servidor (el archivo se relee en cada intento de login).

**Recomendaciones importantes:**
- `data/users.txt` **no se sube al repositorio** (está en `.gitignore`) porque contiene los hashes de las contraseñas reales — hay que crearlo en cada entorno donde corra la app.
- El servidor guarda el archivo con permisos `600` (sólo lectura/escritura para el dueño del proceso); no lo compartas ni lo hagas más permisivo.
- Ya hay protección básica contra fuerza bruta: tras 5 intentos fallidos seguidos desde la misma IP, esa IP queda bloqueada 15 minutos. Además, si el usuario no existe, el servidor igual hace una verificación Argon2id contra un hash señuelo, para que el tiempo de respuesta no delate si un usuario existe o no (lo verificamos: ~89ms en ambos casos).
- **Importante si vas a exponer la app fuera de la intranet** (puerto reenviado desde el router, VPS, túnel, etc.): HTTP Basic Auth por sí solo **no cifra el tráfico**, así que la contraseña viajaría expuesta si el acceso no pasa por HTTPS. Para eso, poné la app detrás de un proxy con TLS en lugar de exponer el puerto `3000` directo a internet. Opciones simples:
  - Un proxy inverso con certificado automático, por ejemplo [Caddy](https://caddyserver.com/) (`reverse_proxy localhost:3000` + tu dominio) o Nginx + Let's Encrypt.
  - Una VPN/túnel privado como [Tailscale](https://tailscale.com/) o [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), que evitan abrir puertos públicos.

## Acceso desde el celular

1. Corré el servidor en una computadora conectada a la misma red Wi-Fi que el celular.
2. Buscá la IP local de esa computadora (ejemplo en Linux/Mac: `hostname -I` o `ifconfig`; en Windows: `ipconfig`).
3. Desde el navegador del celular, entrá a `http://<IP-de-la-computadora>:3000` (por ejemplo `http://192.168.1.50:3000`) e ingresá un usuario creado con `manage-users.js` cuando lo pida.
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
