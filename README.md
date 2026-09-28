# Estado de IPs

Web app mobile-first que muestra el estado **ACTIVO** / **INACTIVO** de una lista de direcciones IP, pensada para consultarse desde el celular en la misma red.

## Cómo funciona

- Un servidor Node.js (Express) chequea cada IP:
  1. Intenta un **ping ICMP** (comando `ping` del sistema).
  2. Si el ping falla o no está disponible (permisos, ICMP bloqueado), hace un **fallback por TCP** intentando conectar a puertos comunes (80, 443, 22, 8080, 3389, 21, 23, 445). Si alguno responde o rechaza la conexión, el host se considera activo.
- El frontend consulta el estado cada 8 segundos y se puede refrescar manualmente.
- La lista de IPs se guarda en `data/ips.txt`, un archivo de texto plano, y se puede editar tanto a mano como desde la misma web (agregar / eliminar), salvo que se desactive con `ALLOW_IP_EDITS` (ver más abajo). Cada IP muestra en el front su nombre nemotécnico en lugar de la dirección cruda.
- Si una IP pasa de ACTIVO a INACTIVO, suena una alarma sonora en bucle hasta que se silencia manualmente. Se puede desactivar por completo con el botón 🔔/🔕 (la preferencia queda guardada en el navegador).
- El acceso a toda la app (front y API) requiere autenticación HTTP Basic.

## Requisitos

- Node.js 18+
- El comando `ping` instalado en el sistema donde corra el servidor (recomendado, mejora la precisión). Si no está disponible, la app igual funciona usando el fallback por TCP.

## Instalación y uso

```bash
npm install
npm start
```

Por defecto el servidor escucha en el puerto `3000` en todas las interfaces (`0.0.0.0`), lo que permite acceder desde el celular.

Al iniciar sin `AUTH_PASSWORD` definida, el servidor genera una contraseña temporal y la muestra en la consola — copiala de ahí para el primer ingreso.

## Seguridad y acceso

Toda la app (frontend y API) está protegida con **autenticación HTTP Basic**. El navegador va a pedir usuario y contraseña la primera vez.

```bash
AUTH_USER=admin AUTH_PASSWORD="una-contraseña-larga-y-única" npm start
```

- `AUTH_USER` (default `admin`) y `AUTH_PASSWORD`: credenciales de acceso. Si no se define `AUTH_PASSWORD`, se genera una temporal aleatoria en cada arranque (se pierde al reiniciar el proceso), útil sólo para probar en la intranet.
- **Importante si vas a exponer la app fuera de la intranet** (puerto reenviado desde el router, VPS, túnel, etc.): HTTP Basic Auth por sí solo **no cifra el tráfico**, así que las credenciales viajan protegidas sólo si el acceso pasa por HTTPS. Para eso, poné la app detrás de un proxy con TLS en lugar de exponer el puerto `3000` directo a internet. Opciones simples:
  - Un proxy inverso con certificado automático, por ejemplo [Caddy](https://caddyserver.com/) (`reverse_proxy localhost:3000` + tu dominio) o Nginx + Let's Encrypt.
  - Una VPN/túnel privado como [Tailscale](https://tailscale.com/) o [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), que evitan abrir puertos públicos.
- No reutilices `AUTH_PASSWORD` de otro servicio, y cambiala si sospechás que se filtró.

## Acceso desde el celular

1. Corré el servidor en una computadora conectada a la misma red Wi-Fi que el celular.
2. Buscá la IP local de esa computadora (ejemplo en Linux/Mac: `hostname -I` o `ifconfig`; en Windows: `ipconfig`).
3. Desde el navegador del celular, entrá a `http://<IP-de-la-computadora>:3000` (por ejemplo `http://192.168.1.50:3000`) e ingresá el usuario/contraseña cuando lo pida.
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
