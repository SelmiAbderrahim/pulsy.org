# Salida de Prometheus

## Pasos

GET /api/v1/metrics lee únicamente el estado almacenado de los monitores de la
cuenta autenticada. Crea una clave en [Desarrollar → Claves API](/dashboard/api-keys). Cada cuenta puede usar
una clave con alcance `read` o `full` para recopilar métricas.
La consulta no ejecuta comprobaciones, resoluciones DNS, conexiones ni workers.

Si elige una fecha de caducidad para la clave API, debe ser posterior a hoy en UTC. La clave caduca a las 23:59:59.999 UTC de la fecha elegida. Sin fecha, sigue válida hasta que se revoque.

## Configuración de scrape

Configuración de ejemplo; sustituye el dominio por el de tu instalación:

```yaml
scrape_configs:
  - job_name: pulsy
    scheme: https
    metrics_path: /api/v1/metrics
    static_configs:
      - targets: ['pulsy.example.com']
    authorization:
      type: Bearer
      credentials_file: /etc/prometheus/pulsy-api-key
    scrape_interval: 60s
```

## Comportamiento

Guarda la clave en ese archivo con acceso restringido, nunca en URL, repositorios
o capturas. Para rotarla, crea otra clave, actualiza el archivo y revoca la anterior.
Se mantienen las reglas existentes de caducidad y revocación.

Las siete métricas son gauges con el prefijo pulsy_monitor_:

## Consultas de ejemplo

- status: -1 desconocido, 0 caído, 1 disponible, 2 degradado. Sin comprobación
  válida o en estado pending, la salud permanece desconocida.
- fresh: 1 solo cuando el monitor está activo, el estado es conocido y la edad
  de la comprobación está entre cero y dos intervalos más el tiempo límite,
  incluidos ambos extremos. Los heartbeats también necesitan un registro de
  plazo; el próximo plazo, si existe, no puede llevar más de diez segundos vencido.
- active: 1 habilitado, 0 pausado.
- last_check_timestamp_seconds: última comprobación en segundos Unix, o NaN.
- duration_seconds: solicitud HTTP, resolución DNS o conexión TCP en segundos.
  El cero se conserva; valores ausentes y heartbeats devuelven NaN.
- open_incident: 1 si hay un incidente medido abierto, 0 en caso contrario.
- tls_expiry_timestamp_seconds: última caducidad TLS observada para HTTP en
  segundos Unix; NaN si falta o si el monitor es de otro tipo.

Las observaciones antiguas, futuras o pausadas tienen fresh=0 sin reescribir
la salud almacenada. Un heartbeat caído sin próximo plazo sigue caído.
Una conexión TCP no acredita la salud de la aplicación. La duración de un trabajo
no es latencia de red; exportar TLS no realiza una nueva comprobación.

## Valores privados y límites

Selecciona explícitamente estados conocidos y recientes:

```promql
pulsy_monitor_status{job="pulsy"} >= 0
  and on (job, instance, monitor_id) pulsy_monitor_fresh{job="pulsy"} == 1
```

Solo se incluye la etiqueta monitor_id: ningún nombre, URL, etiqueta privada,
dirección, secreto o contenido de respuesta. Una consulta acotada lee monitores
e incidentes abiertos, más una lectura conjunta de plazos heartbeat si hace falta.
No recorre el historial. Máximo 1.000 monitores por respuesta; superar el límite
devuelve 422. Las instalaciones mayores pueden seleccionar entre 1 y 200 IDs
separados por comas mediante monitorIds. Los IDs ajenos o inexistentes no generan series.

Se aplica el límite API existente: 60 solicitudes por minuto y clave por defecto,
429 con Retry-After. Clave inválida: 401; acceso insuficiente: 403; consulta
inválida: 422. Las respuestas usan private, no-store; evita cachés públicos
compartidos. Tras reiniciar, la consulta vuelve a leer los datos duraderos.
No se proporciona Prometheus/Grafana alojado ni se introduce un nuevo cobro.

## Solución de problemas

Compruebe primero el monitor, periodo y ajustes guardados. La ausencia de observaciones no significa un servicio sano. Tras un error, conserve el borrador, corrija el campo o requisito indicado y vuelva a intentarlo explícitamente. Genere y revise una nueva vista previa si la anterior quedó obsoleta.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)
