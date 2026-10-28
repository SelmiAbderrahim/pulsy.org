# Objetivos de fiabilidad y contexto de eventos

## Pasos

En el Historial del monitor, elija 24 horas, 7 días, 30 días o un intervalo personalizado en hora local dentro del historial retenido. Actualizar renueva los intervalos móviles. Las filas diarias UTC muestran disponibilidad, cobertura observada y duración de solicitud, resolución o conexión. La duración de ejecución de un latido de tarea no es latencia de solicitud.

## Zonas horarias

Las horas de monitores e incidentes siguen Preferencias → Zona horaria de la cuenta, o la del navegador si se seleccionó. Para intervalos personalizados y horas de anotaciones, use la zona indicada junto a los campos. Los períodos de informes SLA y las tendencias diarias siguen explícitamente en UTC; cambiar la zona de visualización no desplaza esos límites.

## Comportamiento

La disponibilidad ponderada por duración divide el tiempo Up entre el tiempo observado. Down y Degraded consumen presupuesto de caída. Es distinta de la proporción de comprobaciones correctas. Cada nueva observación cubre como máximo un intervalo configurado, limitado a siete días, y termina antes en la siguiente observación. El historial anterior sin observación capturada y los huecos después de ese horizonte siguen siendo desconocidos. Un latido nunca recibido es desconocido. Los plazos de los latidos siguen determinando el estado real; estas estimaciones no deducen salud histórica continua a partir de una muestra obsoleta.

La cobertura indica qué parte del intervalo se observó. El tiempo desconocido no aporta tiempo de caída permitido. Un intervalo completamente observado de 30 días al 99,9 % permite exactamente 2.592 segundos (43 minutos y 12 segundos) de caída. La cobertura parcial reduce la tolerancia al tiempo observado elegible. Sin tiempo observado no se conoce el porcentaje ni el presupuesto. El presupuesto restante no baja de cero; el exceso se registra por separado.

## Objetivos y anotaciones

Los objetivos opcionales no cambian comprobaciones, alertas, estado medido ni PDF SLA o informes mensuales existentes. El presupuesto de disponibilidad usa el objetivo actual como referencia explícita. El cumplimiento de latencia usa la política capturada con cada observación, cuenta solo observaciones Up/Degraded válidas e incluye la igualdad exacta. Cambiar objetivos crea una versión; repetir ajustes idénticos no la duplica. Las versiones anteriores siguen visibles dentro del historial retenido.

El ajuste de mantenimiento es opcional y separado de los resultados originales. Solo se retiran intervalos capturados por una política de exclusión activa; los solapamientos cuentan una sola vez. Silenciar alertas nunca retira tiempo medido. Los cambios posteriores de horarios no reescriben períodos capturados. Sin tiempo ajustado elegible, el porcentaje y el presupuesto ajustados son desconocidos. Esta vista operativa no redefine un contrato SLA.

## Valores privados y límites

Las anotaciones privadas guardan fecha, entorno, versión, descripción breve y enlace HTTP(S) público opcional sin credenciales, consulta ni fragmento. Son exclusivas del propietario y nunca aparecen en páginas públicas. Los secretos conocidos de solicitudes se ocultan; aun así, no introduzca secretos. Los marcadores muestran correlación, no una causa probada. Use solo fechas dentro del historial retenido hasta el presente; los elementos antiguos se paginan en orden estable de fecha e identificador.

Exportar intervalo visible descarga exactamente las mediciones mostradas, con intervalo, fecha de cálculo, cobertura y política. No es un PDF SLA, entrega mensual ni copia de recuperación. Los PDF SLA y los informes mensuales también están disponibles para todas las cuentas.

Todas las cuentas pueden usar claves API con alcance `read` para leer y `full` para escribir. Envíe la clave de la cuenta en `Authorization: Bearer`, nunca en una URL.

## Ejemplo

Lectura: GET /api/v1/monitors/ID/reliability?from=2026-10-09T00%3A00%3A00.000Z&to=2026-10-10T00%3A00%3A00.000Z

Inserción: POST /api/v1/monitors/ID/annotations con JSON {"at":"2026-10-10T00:00:00.000Z","environment":"staging","version":"v2","text":"Despliegue observado","link":null}. Crear devuelve 201. GET en la misma ruta con from/to y limit/cursor opcionales permite paginación privada. Nunca coloque una clave API en una URL.

El historial público requiere activación explícita del propietario de una página publicada. Muestra siete días UTC completos con disponibilidad original, cobertura, ajuste de mantenimiento separado y duraciones tipadas. La página obtiene todos los componentes seleccionados en una sola solicitud al expandirse; cada panel se monta solo al abrirlo. Los huecos siguen desconocidos. No se proyectan nombres privados, URL, notas, objetivos, identificadores de monitores ni secretos. La duración de solicitud no es el tiempo de carga de una página en el navegador. Esta publicación opcional hace visibles mediciones de disponibilidad y rendimiento: revise esta decisión antes de activarla.

El contexto pagina todos los incidentes medidos que se solapan con el intervalo visible. Las duraciones se recortan en ambos límites, incluidos incidentes ya abiertos y recuperados después. Las causas ordenan los 1.000 incidentes coincidentes más recientes por duración sumada; por encima aparece una etiqueta parcial, mientras la paginación sigue completa. Los incidentes simultáneos pueden solaparse: estos totales no calculan disponibilidad. Las causas privadas se ocultan según la configuración actual de solicitudes. La fecha de una anotación por sí sola no demuestra una causa.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)
