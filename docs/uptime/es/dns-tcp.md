# Monitorización DNS y TCP

Todas las cuentas pueden supervisar DNS y TCP, además de HTTP y heartbeat. El historial sigue el ajuste del operador `CHECK_LOG_RETENTION_DAYS`.

## Pasos

En el menú «Añadir monitor», elige «Monitor DNS / TCP» y completa nombre, host, intervalo, tiempo máximo y fallos consecutivos antes de caída. La creación es explícita; los monitores activos inician comprobaciones programadas. Desactivar detiene las comprobaciones sin hacer sano el servicio. Mantenimiento y silencio evitan notificaciones mientras siguen las comprobaciones y el historial medido. Reconocimiento, notas y comunicación pública son independientes de la salud.

## Ejemplo

DNS admite A, AAAA, CNAME, MX y TXT mediante el resolutor del sistema configurado por el operador. Los nombres ASCII/punycode tienen hasta 253 caracteres; se conservan prefijos como `_acme-challenge.example.invalid`. Introduce un nombre, sin URL ni puerto. Elige existencia o conjunto esperado exacto, escrito como matriz JSON:

- A: `["1.1.1.1"]`; AAAA: `["2001:4860:4860::8888"]`.
- CNAME: `["api.example.invalid"]`.
- MX: `[{"priority":10,"exchange":"mail.example.invalid"}]`.
- TXT: `["Case Sensitive", ""]`. Cada cadena es un registro completo, con los fragmentos de ese registro unidos. Una cadena vacía no equivale a ausencia de respuesta.

El orden y las ocurrencias duplicadas no afectan a la comparación. Se normalizan las direcciones; CNAME y hosts MX ignoran mayúsculas y el punto final. La prioridad MX sigue siendo significativa. TXT conserva contenido, espacios y mayúsculas exactos. Respuestas cambiadas o eliminadas incumplen el conjunto esperado; no se aprende otra referencia automáticamente. Cambiar el tipo no sustituye las expectativas escritas: corrige el JSON antes de guardar.

Se distinguen nombre inexistente, respuesta vacía, fallo temporal de resolución, tiempo agotado, conjunto distinto, dirección prohibida y exceso de límites. Máximo 50 respuestas, 4 KiB por TXT y 64 KiB para expectativas/respuestas normalizadas; hasta 60 000 ms. Las consultas nativas se cancelan al vencer el plazo. El resolutor es infraestructura de confianza del operador; esta interfaz no permite elegir servidores DNS arbitrarios. No se almacenan respuestas completas como observaciones.

## Comportamiento

TCP establece una conexión nativa a un host y puerto 1–65535. El plazo incluye resolución y establecimiento, hasta 60 000 ms. Una conexión correcta está sana; rechazo, plazo agotado, fallo de resolución o destino prohibido cuentan como fallo según el umbral consecutivo. Se cierra el socket tras cada intento. Un puerto abierto no demuestra autenticación, salud de aplicación ni certificado TLS. Esta función no activa comprobación TLS de TCP.

Listas, detalles, historial, incidentes y canales comparten el flujo de salud. DNS mide la consulta; TCP incluye resolución y conexión. Los valores son milisegundos, no carga de página del navegador. Las reglas opcionales de latencia usan esos tiempos y la histéresis de recuperación existente. Los datos desconocidos quedan neutrales y el historial medido permanece intacto. Reconocer o publicar no fabrica recuperación.

## Valores privados y límites

Las etiquetas conservan mayúsculas y límites. Duplicación y plantillas copian configuración de red no secreta y requieren creación explícita, sin IDs, historial, incidentes, publicación ni destinatarios. Los cambios de plantilla afectan a futuras creaciones. El manifiesto nativo versión 1 incluye DNS/TCP tipado, expectativas limitadas, política temporal y referencias a canales de la cuenta. Vista previa sin escritura; aplicación aditiva, atómica e idempotente, sin borrado ni publicación implícitos. Las claves API usan `read` para leer y `full` para escribir, disponibles para todas las cuentas.

Los destinos CNAME conservan los guiones bajos en sus nombres DNS. El conjunto MX nulo esperado es `[{"priority":0,"exchange":"."}]` y no debe contener otros registros MX. Indica que el dominio rechaza deliberadamente el correo; no demuestra que un servicio SMTP sea accesible ([RFC 7505](https://www.rfc-editor.org/rfc/rfc7505.html)). El nombre raíz vacío del resolutor nativo se compara con ese punto explícito. Una respuesta MX nula mezclada o con prioridad distinta de cero falla.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)
