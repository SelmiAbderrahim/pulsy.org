# Comprobaciones HTTP avanzadas

## Pasos

La adición rápida conserva GET. En Nuevo monitor o Ajustes, abra Comprobaciones HTTP avanzadas para añadir reglas y valores privados. Todas las reglas activas deben pasar sobre la misma respuesta; un conjunto no añade sondas HTTP. Las redirecciones pueden hacer hasta seis solicitudes incluyendo la inicial.

## Comportamiento

Reglas: cuerpo contiene/no contiene, cabecera igual/contiene, JSON existe/igual/distinto/menor/como máximo/mayor/como mínimo. Las rutas JSON comienzan por `$`, seguidas de claves ASCII con puntos o índices numéricos, como `$.status` y `$.jobs[0].depth`. Se rechazan claves entre comillas, comodines, scripts, claves de prototipo y expresiones. Introduzca valores como `"ok"`, `0`, `false`, `null` o una lista plana de estos. Ausente difiere de null, false, cero, texto vacío y lista vacía. Un campo ausente falla toda comparación, incluso distinto. Los números no convierten cadenas. JSON inválido falla las reglas JSON activas.

## Ejemplo

HTTP 200 Y `$.status` igual `"ok"` Y `$.queueDepth` menor que `100` exige las tres condiciones. HTTP 200 con `{"status":"error"}` cuenta como caído al activar esa regla. Los ajustes avanzados consideran caído un estado HTTP inaceptable. Los monitores antiguos sin ellos conservan su comportamiento, incluido degradado para respuestas inesperadas inferiores a 400. El tiempo mide esta petición, no carga del navegador.

## Valores privados y límites

Cabeceras privadas, autenticación Basic/Bearer y cuerpo POST se cifran juntos con ENCRYPTION_KEY existente. No se recuperan en el editor. Conservar mantiene; Reemplazar exige nueva entrada y elimina valores omitidos; Borrar elimina todo. requestConfig omitido en API conserva, null borra, un objeto reemplaza. No incluya credenciales en URLs ni reglas. Se rechazan credenciales en URLs nuevas o editadas. El cuerpo requiere POST; cambiar de método exige borrarlo o reemplazarlo explícitamente.

Los nombres de cabecera son únicos sin distinguir mayúsculas. No se sustituyen Host, Content-Length, Connection ni Transfer-Encoding. Límites: 20 cabeceras, 16 KiB de configuración codificada, 4.096 caracteres por valor y 64 KiB UTF-8 de cuerpo. Los usuarios Basic no contienen dos puntos. Los valores privados se excluyen de páginas de estado, enlaces compartidos y proyecciones REST/propietario. Los enlaces compartidos omiten ajustes avanzados. Las plantillas y manifiestos nativos incluyen reglas y políticas de latencia admitidas sin valores privados de solicitud.

Con valores privados, reglas o política de redirección distinta, Seguir revalida cada destino con la política de red, para tras cinco saltos y elimina cabeceras/autenticación configuradas al cambiar de origen. Se rechazan 307/308 a otro origen con cuerpo. 301/302 POST y 303 salvo HEAD pasan a GET sin cuerpo. Inspeccionar devuelve la primera respuesta; Rechazar falla redirecciones. Las comprobaciones HTTP antiguas también validan cada destino de redirección. Los destinos HTTP(S) rechazan direcciones no especificadas, de metadatos y de enlace local en todas las instalaciones. Los destinos privados e internos (loopback, RFC1918, CGNAT, direcciones únicas locales, `localhost`, `*.internal`, nombres de servicio de una sola etiqueta) se permiten por defecto con `MONITOR_ALLOW_PRIVATE_NETWORKS=true`. Defina `false` para rechazarlos al guardar o importar un monitor y de nuevo al conectar. Las conexiones HTTP siempre usan respuestas DNS validadas al conectar.

Las reglas de cuerpo/JSON leen hasta 512 KiB descomprimidos. JSON admite profundidad 16 y 10.000 nodos. Las reglas solo de cabecera no leen cuerpo. Las reglas de cuerpo HEAD fallan como no leído, sin inventar vacío observado. El tiempo límite continúa durante la lectura. Excesivo y no leído son resultados distintos. No se guardan cuerpos completos ni valores recibidos de reglas; los registros conservan índices, éxito y códigos de motivo acotados.

## Probar sin guardar

Probar sin guardar realiza una sonda explícita única sin planificar, guardar historia ni cambiar salud. Usa el mismo comprobador y configuración efectiva que guardar. POST puede tener efectos y requiere confirmación. Guardar nunca prueba automáticamente.

Todas las cuentas pueden usar claves API con alcance `read` para leer y `full` para escribir. Envíe la clave de la cuenta en `Authorization: Bearer`, nunca en una URL.

Una regla fallida genera un motivo seguro como Assertion 1: mismatch, abre el incidente medido tras el umbral existente y usa notificaciones y supresión de mantenimiento. No publica un anuncio ni modifica la disponibilidad. Cifrado corrupto requiere volver a introducir datos con la clave configurada; no la sustituya ni rote sin preservar secretos.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)

## Direcciones de monitores

Crear monitor, Añadir rápidamente y Añadir en lote aceptan un nombre de host como `example.com` y muestran la dirección normalizada `https://example.com/`. Si falta el nombre, se usa el del host. La detección de duplicados compara las direcciones canónicas con tus monitores existentes y el lote actual, incluidas las variantes con barra final, e indica el nombre del monitor existente. Los parámetros de consulta siguen siendo significativos. Los monitores nuevos usan tres fallos consecutivos de forma predeterminada; los umbrales guardados no cambian.

## Estados aceptados y TLS

El estado esperado acepta `200,204`, `2xx` y `200–299`, incluidas sus combinaciones. Los códigos deben estar entre 100 y 599 y los rangos deben ser ascendentes. Las comprobaciones normales y avanzadas usan la misma regla. Un único código mantiene el comportamiento anterior. El interruptor de supervisión del certificado TLS en Configuración detiene las comprobaciones de vencimiento y las alertas y borra el resultado guardado. La verificación del transporte HTTPS sigue activa. Las plantillas y las exportaciones conservan estos ajustes.

Las configuraciones compartidas también conservan las reglas de códigos aceptados y el ajuste de supervisión TLS, sin observaciones del certificado ni credenciales. Al clonar, las URL canónicas se comparan con tus monitores existentes y con el lote seleccionado, incluidas tus propias configuraciones compartidas.

## Nombres y guardado

El nombre es opcional al crear un monitor HTTP: si queda vacío, se usa el nombre de host de la URL. Los monitores DNS, TCP, servidor y heartbeat, y las plantillas guardadas, requieren nombre. Al editar, Guardar permanece desactivado hasta que los valores difieran de la versión guardada. Restaurar los valores originales elimina el aviso de cambios sin guardar. Los campos inválidos muestran un mensaje y un resumen; al enviar, el foco pasa al primero. Si falla el guardado, se conserva el borrador.
