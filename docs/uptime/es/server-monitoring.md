# Servidor Linux

Supervisa los recursos del host y la conexión del agente junto a tus sitios web.

## Instalación

Selecciona **Añadir servidor** y guarda la credencial que solo se muestra una vez. Todas las cuentas pueden supervisar servidores. El intervalo predeterminado es de 60 segundos; se admiten segundos enteros entre 60 y 3600.

Ejecuta el comando mostrado en el host Linux amd64 o arm64. El instalador descarga archivos versionados desde tu origen Pulsy HTTPS y verifica sus sumas de comprobación; luego configura e inicia el agente. Copiado justo después de crear o rotar la credencial, el comando la incluye y no pide nada; queda en el historial del shell del host, trátalo como una contraseña. Después la credencial ya no se muestra y el instalador la pide en una entrada oculta. Nunca en URL ni tickets. Necesitas HTTPS saliente, un certificado de confianza y un reloj correcto. No se abre ningún puerto entrante.

La instalación systemd requiere root; después el servicio usa la cuenta dedicada `pulsy-agent`. Configuración protegida: `/etc/pulsy-agent/config.json`. Diagnóstico: `sudo systemctl status pulsy-agent` y `sudo journalctl -u pulsy-agent`. La reinstalación conserva la configuración.

## Docker Compose

Usa el comando Compose: requiere Docker con el plugin Compose, inicia el contenedor por sí mismo y falla mostrando sus registros si no sigue en ejecución. Los archivos están en `/opt/pulsy-agent`; solo root y el usuario del contenedor pueden leer la configuración. Los montajes de solo lectura de `/proc` y `/` miden el host, no los límites del contenedor. No se usan modo privilegiado, capacidades ni socket Docker. El administrador debe permitir estos montajes. Las medidas inaccesibles quedan no disponibles. Los certificados del host se montan en modo de solo lectura.

## Métricas y alertas

La CPU se calcula mediante diferencias de contadores Linux. La primera muestra, un reinicio o un contador restablecido dejan la CPU no disponible. La RAM utiliza `MemAvailable`. Sin swap, su métrica no está disponible. El uso de archivos refleja el espacio disponible para usuarios sin privilegios; se excluyen montajes virtuales y de contenedores. Las rutas excluidas incluyen sus descendientes. La carga cubre 1, 5 y 15 minutos; el tiempo activo comienza al arrancar el host.

Umbrales predeterminados: 90 % para CPU, RAM y cada sistema de archivos. Tres infracciones consecutivas activan una condición; dos informes por debajo del umbral la recuperan. Las condiciones son independientes. La presión de recursos significa degradado. Tres intervalos sin informes aceptados significan caída. Dos informes confirman la vuelta; otras condiciones pueden mantener el estado degradado. Los plazos se comprueban cada cinco segundos. Las notificaciones respetan canales, mantenimiento y reintentos. Los monitores pausados no alertan; reanudarlos abre una nueva ventana de conexión.

Los nuevos monitores permanecen pendientes hasta el primer informe. Tras tres intervalos aparece ayuda de diagnóstico. Las alertas de RAM no confirman procesos terminados por falta de memoria. Los valores ausentes no recuperan alertas activas; restaura un montaje desaparecido o exclúyelo explícitamente.

## Historial y privacidad

La recepción determina la conectividad. Las muestras duplicadas o antiguas no la prolongan. La retención sigue el ajuste del operador `CHECK_LOG_RETENTION_DAYS`, cuyo valor predeterminado es de 30 días. El gráfico muestra hasta 1000 informes y la tabla las últimas 50 muestras mostradas. Los datos antiguos se eliminan por lotes. Eliminar el monitor borra sus métricas y credencial. Las páginas públicas no revelan metadatos del host, rutas ni métricas privadas.

## Rotación, actualización y eliminación

Rota la credencial en ajustes y ejecuta el instalador descargado con `--rotate` antes del argumento del origen. Solicita la nueva credencial y reinicia systemd. La anterior deja de funcionar inmediatamente. Para actualizar, descarga el instalador de la versión deseada y utiliza `--upgrade`. Reinicio: `sudo systemctl restart pulsy-agent`. Desinstalación: instalador con `--uninstall`.

Con Compose, vuelve a ejecutar `--compose` para actualizar o rotar; el contenedor se recrea automáticamente. Para eliminar: `sudo docker compose -f /opt/pulsy-agent/compose.yaml down`, luego borra `/opt/pulsy-agent`. Elimina el monitor por separado en Pulsy.

## Diagnóstico y límites

Comprueba registros, DNS/HTTPS saliente, certificados, credencial, reloj y permisos. Espera dos muestras para la CPU. Respeta el intervalo efectivo devuelto por Pulsy. La versión 1 no detecta OOM kills, no supervisa procesos ni ejecuta comandos remotos, y no admite Windows ni macOS.

Activa las notificaciones de estado degradado del canal para las alertas de CPU, RAM y sistemas de archivos, y las de caída para los informes ausentes.

## Sistemas de archivos excluidos

En Configuración del servidor, introduzca una ruta absoluta por línea, como `/var/lib/docker`. Cada entrada empieza por `/`; no se admiten listas separadas por comas ni rutas relativas. Se aceptan hasta 32 rutas, de un máximo de 512 bytes UTF-8 cada una, sin caracteres de control. Excluir una ruta también excluye sus descendientes.
