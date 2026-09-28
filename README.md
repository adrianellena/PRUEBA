# Estado de IPs

Web app mobile-first que muestra el estado **ACTIVO** / **INACTIVO** de una lista de direcciones IP, pensada para consultarse desde el celular en la misma red.

## Cómo funciona

- Un servidor Node.js (Express) chequea cada IP:
  1. Intenta un **ping ICMP** (comando `ping` del sistema).
  2. Si el ping falla o no está disponible (permisos, ICMP bloqueado), hace un **fallback por TCP** intentando conectar a puertos comunes (80, 443, 22, 8080, 3389, 21, 23, 445). Si alguno responde o rechaza la conexión, el host se considera activo.
- El frontend consulta el estado cada 8 segundos y se puede refrescar manualmente.
- La lista de IPs se guarda en `data/ips.json` y se puede editar desde la misma web (agregar / eliminar).

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

Se puede hacer desde la interfaz web (formulario "Agregar" y botón ✕ para eliminar), o editando directamente `data/ips.json`:

```json
[
  { "id": "uuid", "name": "Router", "ip": "192.168.1.1" }
]
```
