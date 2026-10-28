# Respuesta personal a incidentes

## Pasos

Abra Incidentes desde el panel. Busque nombre de monitor o causa y filtre Sin resolver (Abiertos y Reconocidos), Abiertos
(sin reconocer y todavía medidos como fallando), Reconocidos, Resueltos o Todos.
Severidad es la importancia registrada al iniciar un incidente nuevo; históricos
muestran Desconocida sin inventar valores. Filas muestran cuenta propietaria,
inicio, duración en segundos y última actualización. Cursor usa orden estable
por inicio/ID. Filtros, páginas e incidente elegido están en URL: recargar y
Atrás/Adelante conservan contexto. Enlaces de monitor/grupo filtran solo datos
propios; ID de otra cuenta no concede acceso.

## Preferencias de visualización de horas

Abre el menú de la cuenta al pie de la barra lateral y luego **Preferencias**. Elige **Idioma** y **Zona horaria de la cuenta**, y pulsa **Guardar**. El idioma se guarda en este navegador; una zona IANA explícita se guarda en la cuenta para todos tus dispositivos. Selecciona **Usar la zona horaria del navegador** para seguir cada navegador. Estos ajustes cambian la visualización, no el inicio de los incidentes ni los períodos de los informes.

## Comportamiento

Puede retirar el reconocimiento mientras el incidente siga sin resolver, devolviéndolo a Abierto. Reconocer o retirar el reconocimiento cambia solo el estado de respuesta; la resolución sigue dependiendo de la recuperación medida. Ambas acciones se registran en la cronología privada.

Reconocer registra respuesta, actor y hora, sin pausar comprobaciones, cambiar
disponibilidad, cerrar incidente medido ni publicar. Solo recuperación real lo
cierra. Notas privadas y descripciones de guía son texto plano hasta 2.000
caracteres. Se ocultan valores conocidos de solicitud/auth/cabecera/cuerpo antes
de guardar; no pegue secretos. Enlaces aceptan HTTP(S) sin credenciales incrustadas,
consulta o fragmento. Guardar enlace vacío/omitido borra explícitamente anterior.
Se abren en contexto separado. Notas y guías siguen privadas, nunca anuncios.

## Ejemplo

Seleccione incidentes exactos de la página actual para un grupo de respuesta.
Organiza su trabajo sin fusionar incidentes medidos ni deducir causa común.
Cambiar filtros/página limpia selección. Todos los IDs se verifican en servidor
en una transacción; uno ajeno o ausente rechaza todo. Hasta 100 incidentes por
selección y techo técnico actual de 200 grupos por cuenta.

Cronología registra reconocimiento, notas, cambios de guía y agrupación. Nuevas
transiciones y resultados de alertas se guardan separados del historial bruto;
limpiar muestras no borra la respuesta. Datos históricos se muestran si quedan
fuentes retenidas. No se proyectan cuerpos, destinatarios, errores del proveedor,
secretos o configuración privada. Panel muestra últimos 100 eventos indicando
truncamiento. Hasta 1.000 acciones humanas privadas por incidente. Eventos siguen
retención/eliminación del incidente, no un archivo de auditoría permanente.

Este flujo pertenece a la cuenta propietaria. El modelo de permisos actual no permite asignar incidentes a compañeros ni compartir su gestión entre cuentas.

## Escalada diferida

Escalación diferida opcional usa un plan inmutable por incidente medido, con canal
primario y opcionalmente otro segundo canal propio distinto. Retrasos absolutos
desde inicio del incidente: 60–86.400 segundos; un plazo vencido es elegible en el
siguiente escaneo. Segundo espera al fin del primer intento y puede avisar mientras
permanezca sin resolver/reconocer. Cambiar destino afecta intentos posteriores;
recibos exactos evitan repetición/recuperación a destinos nuevos. Cancele explícitamente
para detener recordatorios restantes. Reconocer para solo recordatorios de ese
incidente, no transiciones ordinarias, otros incidentes ni recuperación real.
Pausa, importancia informativa y recuperación paran recordatorios. Mantenimiento
los aplaza sin cambiar hechos medidos.

## Avisos de recuperación

Recuperación llega también a destinos habilitados e intactos que recibieron una
escalación, aunque alerta inicial no se entregó. Sin recordatorio entregado no
hay recuperación inventada. Política ordinaria existente sigue. Anuncios y
suscripciones de clientes permanecen separados. Todas las cuentas disponen de acceso API, informes SLA e informes mensuales.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)

Selecciona al menos dos incidentes para crear un grupo de respuesta. Las acciones permanecen bajo la lista sin mover las filas. El panel tiene un único botón de cierre fijo y un cuerpo desplazable; Esc lo cierra y devuelve el foco a la fila seleccionada.
