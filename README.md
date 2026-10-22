# Control de entrega de kits

Aplicación independiente con interfaz HTML + Bootstrap y API Node + Express. Consulta `registros` y `participantes` sin modificarlos. La única escritura de la aplicación es una fila en `entregas_kits` por cada registro confirmado con folio.

## Uso local

1. Configura `DATABASE_URL`, `KIT_ADMIN_USER`, `KIT_ADMIN_PASSWORD` y `SESSION_SECRET` en `.env`. Hay un ejemplo en `.env.example`. La contraseña requiere 16 caracteres como mínimo y el secreto de sesión 32. El evento predeterminado es `voces-que-corren-2026`; puedes definir `KIT_EVENT_SLUG` si cambias de carrera.
2. `npm install`
3. `npm run db:migrate` (una sola vez; crea la tabla sin alterar los registros existentes).
4. `npm run dev` y abre `http://localhost:8001`.

La cuenta es compartida, pero cada encargado escribe su nombre al entrar. Ese nombre queda guardado con la hora de entrega. Si dos equipos intentan entregar el mismo folio, la base acepta solo una entrega y el otro equipo recibe un aviso.

## Netlify

Despliega **esta carpeta como proyecto independiente** desde Git. Si vive dentro del repositorio principal, selecciona `kit-entrega` como directorio base del nuevo sitio. El `netlify.toml` ya define el build, el HTML y los archivos públicos, además de la función Express para la API. No sirve arrastrar solo `public` a Netlify: se necesita el build para incluir la función.

Configura en Netlify, para el alcance **Functions**, estas cuatro variables con los valores de tu `.env` local: `DATABASE_URL`, `KIT_ADMIN_USER`, `KIT_ADMIN_PASSWORD` y `SESSION_SECRET`. No subas `.env`. Mantén el mismo `SESSION_SECRET` entre despliegues para conservar las sesiones vigentes.

`npm run build` copia Bootstrap, SweetAlert2 y el lector QR a `public/vendor` para que la interfaz y los avisos funcionen sin depender de un CDN. La fuente Montserrat utiliza Google Fonts y tiene respaldo local Arial.

## Operación

- Busca por folio exacto o nombre. Los nombres coinciden con o sin acentos y sin distinguir mayúsculas. La lista se actualiza al editar la búsqueda y se limpia al borrar el texto.
- **Escanear QR** abre la cámara del equipo y busca el folio del comprobante automáticamente. En Netlify usa HTTPS; en local también funciona en `localhost`. Si el navegador no permite usar la cámara, escribe el folio manualmente. Escanear nunca registra la entrega.
- Comprueba nombre, folio, categoría y talla antes de pulsar **Marcar kit entregado**.
- Confirma la acción en el aviso. Una entrega registrada no puede duplicarse desde otro equipo.
- Los contadores se actualizan al entrar y después de cada entrega. El anillo de confirmados usa como referencia la suma de cupos activos femenil y varonil; los anillos de entregados y pendientes usan el total confirmado. La búsqueda siempre lee el estado actual de PostgreSQL.

La aplicación no incluye una opción para borrar o revertir entregas. Si hay una incidencia, revisa la fila correspondiente en `entregas_kits` antes de cualquier corrección manual.
