# Mantenimiento y suspensión de alertas

## Pasos

Seleccione monitores y Mantenimiento y suspensión, o abra los ajustes de un monitor. Estas opciones están disponibles para todas las cuentas. Solo cambian las notificaciones: continúan las comprobaciones, la salud medida, la disponibilidad bruta y los incidentes medidos. Un monitor caído puede mostrar también Mantenimiento. Suspender alertas no pausa las comprobaciones.

Elija 15 minutos, una hora, cuatro horas o una fecha final dentro de 30 días. El motivo privado y la hora de reanudación siguen visibles en sus controles. Reanudar alertas retira únicamente los monitores seleccionados de las suspensiones; conserva los calendarios de mantenimiento. Terminar un calendario afecta a toda su selección explícita y requiere confirmación. Los monitores añadidos después no se incluyen automáticamente.

Los calendarios avanzados tienen nombre, motivo privado, inicio, fin, zona IANA y repetición única, diaria o semanal. Las fechas usan la zona local del navegador. La zona IANA determina los inicios locales de futuras repeticiones. Revise las ocurrencias antes de guardar; cambiar cualquier campo exige otra vista previa. La duración transcurrida máxima es de 24 horas para repeticiones y 30 días para ventanas únicas. Se omiten los inicios locales inexistentes al pasar al horario de verano; las repeticiones siguen el desfase local. Guardar o previsualizar no sondea un endpoint de cliente.

La supresión incluye el inicio y excluye el fin. Se combinan todos los calendarios y suspensiones aplicables; terminar uno no termina otro. Un worker persistente verifica las ventanas activas inmediatamente antes de entregar. Tras la última ventana, un monitor activo que continúa en la misma caída recibe una alerta diferida por destino elegible. Las caídas recuperadas, pausadas, eliminadas o reemplazadas no generan esa alerta. La recuperación de una caída suprimida solo llega a los destinos exactos con un recibo de entrega exitosa de la alerta de caída. Añadir o cambiar un destino no autoriza su recuperación.

El historial distingue intentos, aceptación, fallos y supresión según la evidencia disponible. La aceptación del proveedor no prueba la llegada al buzón. Revise el fallo antes de reintentar: un resultado incierto puede causar mensajes duplicados.

El límite técnico es de 200 calendarios activos por cuenta. Las ventanas únicas expiradas salen de la lista activa inmediatamente. La limpieza diaria elimina por lotes limitados los historiales expirados o cancelados y entregas terminadas tras 30 días. Un recibo mínimo de la caída actual por monitor sobrevive a la retención de comprobaciones para mantener la recuperación correcta; se eliminan de él tiempos, estados y motivos históricos.

Los motivos son privados. Para publicar un aviso, abra las comunicaciones de la página elegida, seleccione explícitamente una ocurrencia y sus componentes públicos afectados, redacte otro texto público, previsualice y publique. Futuras repeticiones requieren otra publicación. Consulte la guía de comunicación de estado. El mantenimiento no cambia la disponibilidad bruta ni las exclusiones SLA.
