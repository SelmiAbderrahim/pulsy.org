# Degradación por latencia y recuperación estable

## Pasos

Al crear o en Ajustes, abra Latencia y política de alertas y actívela. Está disponible para todas las cuentas. Adición rápida y monitores sin política conservan su comportamiento. null desactiva y restaura el comportamiento anterior. Una política distinta, incluso por reemplazo masivo, reinicia rachas; la misma u otros cambios las conservan. No elimina comprobaciones, incidentes ni recibos.

## Comportamiento

Los umbrales son opcionales. Active detección lenta para fijar límite superior y número consecutivo. La duración mide esta petición HTTP en milisegundos, incluida lectura para reglas, no carga de navegador. Todas las reglas deben pasar sobre la misma respuesta antes de considerar latencia. Inalcanzable, estado inaceptable y regla fallida son Caído según el umbral de fallos existente. Con política, una respuesta inesperada menor de 400 falla; los monitores antiguos mantienen Degradado para ese caso.

Una respuesta válida estrictamente superior al límite es lenta. La racha configurada cambia Disponible a Degradado. Igualdad no es lenta. Una respuesta válida menor o igual al umbral de recuperación avanza la racha; igualdad cuenta y se permite cero. Este umbral no supera el superior. Valores intermedios reinician recuperación y conservan Caído/Degradado. Caído prevalece hasta completar la racha de recuperación, aun con respuestas válidas lentas. Sin umbrales, toda respuesta válida avanza recuperación. Rachas 1–10, umbrales hasta 60.000ms y espera entre alertas hasta 3.600 segundos.

El monitor muestra estado retenido y progreso; la historia conserva cada muestra bruta Disponible/Caído/Degradado. Un solo incidente medido permanece durante lento → caído sostenido y la recuperación contada lo resuelve. Las causas lentas guardan duración y límite del momento. El gráfico muestra el límite actual; tiempos ausentes quedan como huecos. Cambiar política no reclasifica historia.

Crítico y Advertencia usan canales elegidos/predeterminados. Informativo registra fallos e incidentes sin alertas operativas; sigue contando en disponibilidad bruta. Notificar degradación es una opción explícita del canal, inicialmente desactivada para antiguos y nuevos. Se mantienen caída/recuperación y la política independiente de caducidad TLS.

Las transiciones configuradas entran en la cola persistente. Una nueva alerta espera el intervalo desde la última entrega real; mantenimiento/suspensión pueden retrasarla más. Recuperación omite la espera y llega solo a destinos exactos con recibo exitoso del episodio actual, incluida degradación entregada si la posterior caída se retrasó o desactivó. Escalada conserva identidad. Desactivar conserva asociación de recibos y recuperación persistente del episodio configurado. Una nueva degradación antigua no reutiliza recibos de un episodio recuperado.

## Ejemplo

El historial distingue intentos, aceptación, fallos y supresión según la evidencia disponible. La aceptación del proveedor no prueba la llegada al buzón. Revise el fallo antes de reintentar: un resultado incierto puede causar mensajes duplicados.

Probar configuración es una muestra explícita: validez bruta de reglas y latencia, no estado retenido tras varias. No avanza rachas ni escribe historia/incidentes ni envía alertas. POST requiere confirmación por posibles efectos; guardar nunca prueba automáticamente.

La interfaz está disponible en inglés, árabe, francés, alemán y español. Las lecturas REST muestran la política y los contadores no secretos. Todas las cuentas pueden usar claves API con alcance `read` para leer y `full` para escribir. Envíe la clave de la cuenta en `Authorization: Bearer`, nunca en una URL.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)
