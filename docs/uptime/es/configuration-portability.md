# Importar y exportar

Abre [Importar y exportar](/dashboard/import-export) para exportar los ajustes de los monitores seleccionados o revisar una configuración antes de importarla.

## Pasos

Abra **Desarrollar → Importar y exportar** en la navegación. Seleccione monitores explícitos y Exportar configuración seleccionada. Descargar JSON solo está disponible tras exportar o una vista previa depurada correcta. Cargar un archivo o editar invalida vista previa y descarga. Límites: 200 elementos, 256 KiB de JSON UTF-8, profundidad 16 y 20.000 valores. Se mueven ajustes, no historia, incidentes, publicación, suscriptores, destinatarios, claves API ni copia de recuperación. La interfaz está disponible para todas las cuentas.

## Formato del archivo

Versión 1 contiene `format: "pulsy-monitor-configuration"`, `version: 1` y lista `monitors`. Cada elemento tiene `key` estable local a la cuenta, `type`, `name`, `interval` en segundos, `active` y `tags`. Claves ASCII con letras, números, guion bajo, punto, dos puntos y guion, comienzan por letra/número y tienen hasta 100 caracteres. Se conservan mayúsculas de etiquetas y límites existentes de cada tipo. HTTP exige también `url`, `method`, `expectedStatus`, `timeout` en milisegundos, `failureThreshold` y `redirectPolicy`. `httpAssertions` y `latencyPolicy` son opcionales: omitir conserva valores existentes, null desactiva latencia. Heartbeat requiere `graceSeconds`. Se admiten HTTP, DNS, TCP y heartbeat por intervalo. No se admiten cron ni adaptadores de terceros.

## Ejemplo

```json
{
  "format": "pulsy-monitor-configuration",
  "version": 1,
  "monitors": [{
    "key": "api-production", "type": "http", "name": "API producción",
    "url": "https://example.invalid/health", "method": "GET",
    "expectedStatus": 200, "timeout": 10000, "interval": 300,
    "failureThreshold": 3, "redirectPolicy": "follow", "active": false,
    "tags": ["production"],
    "httpAssertions": [{ "type": "json", "path": "$.status", "op": "equals", "value": "ok" }]
  }]
}
```

## Claves y renombrados

Exportar usa la clave externa existente o `pulsy:<monitorId>` sin vinculación previa. Aplicarla en la misma cuenta vincula sin sustituir el monitor. Una clave nueva crea otro monitor. Para renombrar deliberadamente, añada `previousKey` con la clave antigua propia y elija el nuevo key; la vista previa muestra el cambio. No selecciona monitores ajenos. Se rechazan clave anterior ausente, dos entradas para el mismo monitor, claves antiguas/nuevas contradictorias y cambios de tipo de un monitor vinculado. Repetir un renombrado aplicado es idempotente. Quite previousKey antes de transferir a otra cuenta. Las claves distinguen mayúsculas. No ponga credenciales en nombres, etiquetas, claves ni reglas.

## Valores privados y límites

Los valores privados se omiten y nunca se devuelven. `needsReentry` indica categorías sin rellenar: request, url, assertions o heartbeatToken. Toda URL con consulta o fragmento se omite por prudencia, como las que contienen credenciales o secretos conocidos. url null conserva una URL existente; un nuevo monitor requiere URL segura. Se omiten reglas sensibles de cabecera y reglas con valores privados conocidos; las reglas omitidas existentes se conservan. Se retiran campos importados de petición/autenticación/cuerpo/token/destinatarios/suscriptores antes de validar, y repeticiones conocidas en nombres, etiquetas, URLs y reglas. La vista previa sustituye el editor por JSON depurado. Se rechazan claves de objeto peligrosas, campos desconocidos, claves duplicadas y versiones incompatibles. Hasta 500 valores privados elementales examinados por monitor. Es un formato de campos pendientes, sin integración de almacén de secretos.

Ningún import reemplaza ni borra secretos almacenados. Un cuerpo POST conservado impide cambiar a GET/HEAD; bórrelo o reemplácelo expresamente en ajustes primero. Nuevos HTTP con valores/reglas pendientes permanecen inactivos. Heartbeat no incluye token ni URL: los nuevos trabajos quedan inactivos hasta rotación/copia de token y activación en ajustes. La activación existente se conserva sin importar active del manifiesto; use los controles actuales. Intervalo/gracia cambian sin inventar recepción, recuperación o salud. Hash y ejecuciones anteriores permanecen.

`channelIds` opcional referencia canales propios existentes, sin destinatarios, credenciales ni objetivos de entrega. Omitir conserva vínculos; lista vacía elimina las referencias sin borrar canales. En otra instalación elimine referencias o sustituya por IDs propios. Una referencia ausente, ajena, eliminada o no permitida rechaza la importación. Plantillas, vistas, calendarios, proveedores y pertenencia a páginas públicas quedan fuera.

## Previsualizar y aplicar

Validar y previsualizar no escribe ni sondea. Muestra cambios exactos y cantidades crear/actualizar/sin cambios/rechazado. Aplicar es explícito y atómico: cualquier rechazo, fallo de almacenamiento o configuración obsoleta deja todo sin aplicar. La revisión compara ajustes e identidad de referencias, no cambios normales de salud. Las creaciones concurrentes se serializan mediante un bloqueo transaccional de la fila del propietario, como los monitores normales y heartbeat, sin límite de cantidad de monitores. Se conservan IDs, comprobaciones, incidentes, pertenencia pública y secretos omitidos. Sin eliminación, poda ni sustitución silenciosa. HTTP activo inicia solicitudes programadas; POST puede tener efectos. Otra vista previa muestra Sin cambios sin duplicados. Si todo permanece igual, no hay nada que aplicar.

## Acceso por API

Todas las cuentas pueden usar claves API con alcance `read` para leer y `full` para escribir. Envíe la clave de la cuenta en `Authorization: Bearer`, nunca en una URL. La exportación y la vista previa usan acceso de lectura; aplicar requiere `full`. La interfaz está disponible en cinco idiomas. Las dos primeras rutas POST usan lectura:

```sh
curl -X POST "$PULSY_URL/api/v1/configuration/export" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data '{"monitorIds":["owned-monitor-id"]}'
curl -X POST "$PULSY_URL/api/v1/configuration/preview" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data-binary @preview-request.json
curl -X POST "$PULSY_URL/api/v1/configuration/apply" \
  -H "Authorization: Bearer $PULSY_API_KEY" -H 'Content-Type: application/json' \
  --data-binary @apply-request.json
```

preview-request.json contiene `{"text":"<JSON-escaped native manifest>"}`. apply-request.json contiene el mismo texto y revision recibida, como `{"text":"<same escaped JSON>","revision":"<64-character revision>"}`. Use codificación JSON estándar del CI, sin insertar contenido sin escapar en comandos shell. Revise antes de permitir aplicar. Revisión obsoleta HTTP 409, rechazo/inválido 422, límite del parser 413, JSON malformado 400, compresión no admitida 415. Éxito usa no-store. Sin nueva CLI, paquete, daemon de sincronización ni elusión de permisos.

Repetir la importación mantiene inactivo el monitor HTTP mientras falten los valores privados o las reglas requeridas que se omitieron. Configúralos en los ajustes antes de solicitar la activación mediante otra importación. Se conservan los valores privados ya configurados.

La versión1 incluye también DNS y TCP: `type` es `dns` o `tcp`; `configuration` contiene el host y expectativas tipadas o host/puerto, además de plazo y umbral de fallo. Intervalo configurado, historial conservado con claves de la cuenta, sin publicación ni promesas TLS.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)

Los errores JSON aparecen justo debajo del editor con una explicación segura y la línea/columna. Por ejemplo, `{"bad":` está incompleto en la línea 1, columna 8. El foco pasa al error sin borrar la entrada. Los mensajes nunca repiten valores secretos pegados.


## Selección para exportar

Usa **Seleccionar todos los monitores aptos** para elegir hasta 200 monitores HTTP, DNS, TCP y latidos de tareas. La exportación de servidores Linux está desactivada con una explicación: su agente necesita nuevas credenciales. El servidor también rechaza estas solicitudes. Los manifiestos existentes siguen siendo importables y crean servidores inactivos pendientes de configuración. **Descargar ejemplo** proporciona un ejemplo HTTP inactivo independiente del editor; **Descargar JSON** solo guarda un manifiesto exportado o revisado y saneado.
