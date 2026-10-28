# Vistas personales guardadas y grupos

## Pasos

Configure búsqueda, salud, coincidencia de etiquetas, orden, densidad y agrupación
en el panel y pulse Guardar nueva vista. Una vista guarda filtros para su cuenta,
sin crear monitores, espacios, componentes públicos ni consumo adicional.
Las vistas son personales y pertenecen a la cuenta propietaria. Compartir vistas requiere permisos compatibles y no
se anuncia como disponible.

## Comportamiento

Guarde hasta 200 vistas, con nombres de hasta 80 caracteres, búsqueda de 100 y
50 etiquetas seleccionadas. Son protecciones técnicas para todas las cuentas. Elimine una vista sin uso al alcanzar el límite. Fijar coloca
la vista antes de las no fijadas. Hay una sola predeterminada por cuenta; cambios
concurrentes se serializan. Se aplica únicamente sin parámetros de filtro.
Un enlace explícito tiene prioridad. Limpiar filtros registra un estado vacío
explícito para no reaplicar inmediatamente la predeterminada al recargar.

Aplicar crea una entrada en el historial del navegador. Atrás/Adelante restauran
los filtros exactos de URL; recargar los conserva. Editar un filtro cambia la URL,
pero no la vista guardada hasta Actualizar vista. Se indican cambios sin guardar.
Eliminar borra únicamente filtros guardados; monitores, comprobaciones, incidentes,
ajustes y publicación siguen intactos.

## Ejemplo

Los filtros de etiquetas distinguen mayúsculas. Cualquier etiqueta seleccionada
es una unión; Todas exige cada etiqueta. La búsqueda sigue siendo una subcadena
sin distinción de mayúsculas en nombre, URL y etiquetas. Los enlaces nuevos
codifican listas y conservan comas y texto árabe; los antiguos separados por
comas siguen legibles. Es configuración de interfaz, no exportación programática.

Agrupe por todas las etiquetas o por entornos con prefijo exacto `env:` y valor
no vacío, como `env:production`. No se crean carpetas ni entornos anidados.
Cada grupo cuenta monitores únicos coincidentes; un monitor con varias etiquetas
puede figurar en varios grupos. La suma puede superar el total filtrado.
Los no coincidentes aparecen en Sin grupo coincidente. Agrupar, ordenar y cambiar
densidad conservan selección; cambiar búsqueda, salud o etiquetas limpia selección
y diálogos masivos abiertos. Una actualización quita inmediatamente IDs ocultos
o eliminados de la selección accionable. Seleccionar todos y operaciones masivas
siempre usan IDs únicos explícitos, también entre varios grupos. Las etiquetas
son controles nativos accesibles con teclado.

## Duplicación y plantillas de creación

Duplicar abre un formulario nuevo con nombre derivado, método, estado esperado,
intervalo, timeout, umbral de fallo, reglas de aserción/redirección/latencia y
etiquetas. Introduzca el destino de nuevo. Cabeceras privadas, autenticación y
cuerpo nunca se copian, incluso si existían en origen. Tampoco historial,
incidentes, tokens, pertenencia pública ni suscriptores. Guardar explícitamente
crea un monitor independiente con el intervalo configurado.

Guardar como plantilla abre configuración no secreta editable. Las plantillas
no guardan URL ni valores privados de solicitud. Una advertencia recuerda si
el origen requería datos privados. Pueden referenciar hasta 20 canales propios
existentes, reutilizando ajustes sin copiar destinatarios ni credenciales.
Siguen aplicándose valores predeterminados de cuenta; IDs y destinos duplicados
se deduplican al enviar. Cambios de canal afectan monitores vinculados; eliminar
quita vínculos. Una referencia a un canal eliminado debe quitarse o sustituirse
explícitamente antes de crear. El selector lista hasta 200 canales por tipo e ID,
sin destinos ni destinatarios.

Son personales, con techo técnico de 200 por
cuenta. Guardar una plantilla no crea un monitor. Editar o eliminar no cambia monitores
existentes. Usar abre el formulario normal; cada creación revalida en servidor
intervalo y referencias propias. No hay actualización masiva ni
publicación automáticas.

## Añadir selección a una página existente

Seleccione IDs exactos, elija una página y Vista previa de selección. La revisión
no escribe nada. Muestra identidad y publicación, nombre público exacto de cada
componente añadido, recuentos y campos públicos. Aplicar esta selección añade
solo esos IDs, preservando miembros y orden existentes. No incluye futuras
coincidencias, publica borradores ni cambia la marca pública histórica del monitor.

En una página publicada, aplicar cambia inmediatamente la selección pública.
Nombres, salud medida, disponibilidad, tiempos, última comprobación y fechas
de incidentes recientes son públicos bajo la proyección existente; URL y secretos
siguen privados. Revise nombres antes. Gestionar comunicación permite nombres
públicos separados. Sigue el límite de 100 componentes. Cambios concurrentes de
miembros, publicación o nombres invalidan la vista previa; revise de nuevo.

El reemplazo completo de selección se confirma en una transacción. Un error
de validación o inserción conserva la selección anterior. Añadir y reemplazar
se serializan en la página propia.

Notificaciones lista IDs y tipos de canales reutilizados. Desvincular referencia
quita solo el vínculo de ese monitor; valores de cuenta y canales directos
siguen aplicándose. No elimina ni cambia el canal original. Los canales admitidos son
correo electrónico, webhook, Slack, Discord y Telegram.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)

## Navegación y acciones de monitores

Desde 1024 px, la barra lateral permanece visible y los monitores se muestran en una tabla. Por debajo, use el menú de navegación y las tarjetas de monitores. La densidad compacta y la agrupación siguen disponibles en Filtros del panel en pantallas pequeñas; la densidad compacta afecta a las filas de tabla. En páginas de detalle estrechas, Más acciones junto a las pestañas visibles permite acceder a las restantes.

Use Pausar para detener comprobaciones programadas y alertas, y Reanudar para continuar. Pausado describe la actividad de supervisión por separado del último estado medido. Los heartbeats pueden seguir registrando resultados recibidos durante la pausa; Reanudar inicia un nuevo plazo.
