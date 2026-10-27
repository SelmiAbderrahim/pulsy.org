# Comunicación en la página de estado pública

## Pasos

Abra Páginas de estado en la navegación de la aplicación y luego Gestionar comunicación para la página
exacta. Todas las cuentas pueden publicar páginas y usar dominios propios. Los
componentes públicos referencian únicamente monitores propios seleccionados de
forma explícita. Las páginas existentes usan inicialmente los nombres de monitor
ya divulgados; configure nombres y descripciones públicos separados para ocultar
nombres privados de despliegue. Los grupos son etiquetas simples que distinguen
mayúsculas. Aparecen en el orden de su primer componente, conservando el orden
editado dentro de cada grupo. Mueva componentes deliberadamente, revise todos los
nombres, descripciones y grupos públicos y aplique. No se añaden futuras coincidencias
de etiquetas ni URL o configuración privada de solicitudes. Una selección sin
cambios conserva sus claves; quitar y volver a añadir crea una identidad nueva.
Aplicar nombres a una página publicada la cambia inmediatamente. La vista previa
indica si está publicada. Los cambios de página, miembros o nombres invalidan la
vista previa y requieren otra revisión.

## Ejemplo

Redacte un anuncio separado con título, texto plano multilínea, etapa
Investigando/Identificado/En observación/Resuelto, componentes afectados exactos
y zona IANA. Guarde primero un borrador privado. La vista previa muestra página,
nombres públicos afectados, texto, etapa y zona. Publique explícitamente; antes
debe publicar una página no publicada mediante su control existente. Publicar no
reconoce un incidente privado, cambia la salud medida, cierra un incidente medido
ni pausa comprobaciones. Las notas y guías privadas nunca se copian a anuncios
para clientes. Se ocultan los valores de solicitud configurados y las URL con
credenciales antes de almacenar el borrador; no pegue secretos. El texto se
muestra escapado con saltos de línea, sin HTML ejecutable ni scripts arbitrarios.

## Comportamiento

Una actualización publicada es inmutable. Publicar seguimiento crea un borrador
nuevo que la referencia y exige guardar, revisar y publicar de nuevo. Editar un
borrador privado no modifica un registro publicado. Los cambios concurrentes
invalidan vistas previas antiguas, incluso si el borrador cambia mientras espera
el bloqueo de página. La gestión muestra los últimos 100 registros y admite
actualmente 1.000 por página. Deben añadirse archivo y paginación antes de alcanzar
ese límite técnico. Estas son limitaciones técnicas de funcionamiento.

Un aviso de mantenimiento selecciona una programación propia habilitada, una de
sus cinco próximas ocurrencias verificadas y componentes exactos que pertenecen
tanto a la programación como a la página. Posponer alertas no es un aviso público.
Redacte el texto público por separado; los motivos internos siguen privados.
La vista previa muestra inicio y fin en la zona IANA de la programación. La
publicación cubre solo la ocurrencia elegida; la recurrencia continúa de forma
independiente y cada aviso posterior exige otra publicación explícita. Cancelar
o cambiar la programación antes de publicar invalida el aviso. Publicar no cambia
la disponibilidad bruta ni la política de supresión de alertas.

RSS y Atom usan la misma proyección pública segura. Las direcciones dedicadas son
`/api/status/pages/<publicKey>/feed.rss` y `feed.atom`; `status.json` tiene versión 1
y `badge.svg` muestra el estado global almacenado. publicKey es un identificador
público no secreto, sin acceso a configuración ni cuenta. Páginas ausentes o en
borrador no están disponibles. Los estados vacíos o parcialmente observados
siguen siendo desconocidos; un componente Caído o Degradado mantiene la prioridad.
Lecturas y feeds nunca ejecutan comprobaciones. Excluyen URL, cabeceras, secretos,
suscriptores, notas internas, datos de verificación de proveedor/dominio y correos.
asOf es la hora de generación de respuesta; la última comprobación del componente
sigue siendo un hecho almacenado. Accept-Language elige entre cinco idiomas para
la insignia. Los feeds conservan el texto público redactado por el autor.

## Suscripciones por correo

Active suscripciones por correo solo con un proveedor verificado y utilizable
de su cuenta. Pulsy no financia un servicio de correo; los destinatarios de alertas
nunca se importan. Guarde con confirmación explícita. Sustituir proveedor,
desactivar o cambiar presupuesto cancela trabajos no enviados de la configuración
anterior; los envíos iniciados pueden terminar. Los suscriptores confirmados
mantienen su consentimiento para futuros mensajes; los dados de baja permanecen
de baja. La gestión muestra recuentos privados y categorías seguras de fallo,
nunca direcciones ni tokens. La aceptación del proveedor no demuestra entrega
en la bandeja de entrada.

## Valores privados y límites

Los visitantes eligen toda la página, incluidos futuros componentes publicados
explícitamente, o componentes exactos, introducen correo y solicitan confirmación.
Se eliminan espacios externos y se normalizan mayúsculas para deduplicar por
página. Hay 24 horas para confirmar y 15 minutos antes de solicitar de nuevo.
Cambiar el alcance exige nueva confirmación; el alcance confirmado anterior sigue
activo mientras tanto. Los nuevos suscriptores reciben futuras actualizaciones
coincidentes, no historial. Quitar y volver a añadir un componente genera otra
clave y no sustituye silenciosamente una selección. Los enlaces de confirmación
y baja usan un fragmento eliminado antes de iniciar router y analítica, mantenido
solo en memoria de esa página. La acción exige pulsar; visitar el enlace no hace
nada. La baja funciona tras retirar la publicación; eliminar la página borra
registros. Los tokens antiguos no pueden modificar una inscripción confirmada
posterior. Las respuestas neutrales no revelan si un correo está registrado;
enlaces caducados pueden no tener efecto. No hay importación de destinatarios ni
reinscripción automática.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)

Los ajustes de suscriptores muestran solo los requisitos pendientes de publicación y proveedor, con enlaces a General, a la selección de proveedor o a Notificaciones. El proveedor debe pertenecer a la cuenta, estar verificado y tener credenciales completas y descifrables. La marca de verificación por sí sola no basta. La respuesta de disponibilidad no incluye secretos del proveedor.
