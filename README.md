# Estado de IPs

Web app mobile-first que muestra el estado **ACTIVO** / **INACTIVO** de una lista de direcciones IP, pensada para consultarse desde el celular en la misma red.

## Cómo funciona

- Un servidor Node.js (Express) chequea cada IP:
  1. Intenta un **ping ICMP** (comando `ping` del sistema).
  2. Si el ping falla o no está disponible (permisos, ICMP bloqueado), hace un **fallback por TCP** intentando conectar a puertos comunes (80, 443, 22, 8080, 3389, 21, 23, 445). Si alguno responde o rechaza la conexión, el host se considera activo.
- El frontend consulta el estado cada 8 segundos y se puede refrescar manualmente.
- La lista de IPs se guarda en `data/ips.txt`, un archivo de texto plano, y se puede editar tanto a mano como desde la misma web (agregar / eliminar). Cada IP muestra en el front su nombre nemotécnico en lugar de la dirección cruda.

## Requisitos

- Node.js 18+
- El comando `ping` instalado en el sistema donde corra el servidor (recomendado, mejora la precisión). Si no está disponible, la app igual funciona usando el fallback por TCP.

## Instalación y uso

```bash
npm install
npm start
```

Por defecto el servidor escucha en el puerto `3000` en todas las interfaces (`0.0.0.0`), lo que permite acceder desde el celular.

## Acceso desde el celular

1. Corré el servidor en una computadora conectada a la misma red Wi-Fi que el celular.
2. Buscá la IP local de esa computadora (ejemplo en Linux/Mac: `hostname -I` o `ifconfig`; en Windows: `ipconfig`).
3. Desde el navegador del celular, entrá a `http://<IP-de-la-computadora>:3000` (por ejemplo `http://192.168.1.50:3000`).
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
