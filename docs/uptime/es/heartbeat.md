# Heartbeats por intervalo

## Configurar un heartbeat

Elija **Añadir monitor → Heartbeat de tarea**. Indique nombre, intervalo esperado y margen antes de marcar la tarea como caída. El intervalo va de 30 segundos a siete días; el margen de cero a siete días. Se admiten intervalos, no expresiones cron. Revise próxima llegada, fin del margen y zona horaria antes de guardar.

Vista general y Configuración muestran una URL de ping oculta. Use Mostrar o Copiar URL cuando lo necesite; los tokens nuevos y rotados se almacenan cifrados y solo puede recuperarlos su propietario con sesión iniciada. Los tokens antiguos guardados solo como hash requieren rotación en Configuración para poder copiar la URL. Rotar invalida inmediatamente el token anterior sin borrar el historial. Mantenga estas URL secretas fuera de registros, capturas y archivos versionados. El proxy nginx incluido excluye las rutas heartbeat de los registros sin distinguir mayúsculas, incluso para solicitudes fallidas; configure la misma exclusión en cualquier proxy externo.

## Enviar un resultado

Después de un éxito, envíe la solicitud siguiente con su dirección y token. Para un fallo, use `/api/heartbeat/fail`. Para medir la duración, envíe `/api/heartbeat/start` antes y `/api/heartbeat/success` o `/api/heartbeat/fail` después. Use el mismo `runId` al iniciar y terminar ejecuciones simultáneas o reintentadas.

La URL copiada es `/api/heartbeat/{token}/success`. Envíe POST con `Content-Type: application/json` y el cuerpo `{}`, incluso sin otros datos. Sustituya `success` por `start` o `fail` para los otros eventos. Siguen disponibles las rutas con cabecera `Authorization: Bearer`; no combine una URL con token y una cabecera de autenticación.

```sh
curl -fsS -m 10 --retry 3 "$PULSY_SERVER/api/heartbeat/$PULSY_HEARTBEAT_TOKEN/success"
```

```sh
curl -fsS -m 10 --retry 3 -X POST "$PULSY_SERVER/api/heartbeat/success" \
  -H "Authorization: Bearer $PULSY_HEARTBEAT_TOKEN" \
  -H 'Content-Type: application/json' -d '{"runId":"nightly-42"}'
```

## Entender el resultado

Nuevo significa que no se ha recibido ningún éxito, no que la tarea esté sana. El primer éxito se espera un intervalo después de crear el monitor. Su ausencia pasa a Tarde al vencimiento y a Caído al terminar el margen. Sin margen, pasa directamente a Caído. Un éxito restaura el estado e inicia otro intervalo; un fallo marca Caído inmediatamente. Iniciar una tarea no amplía el plazo ni restaura la salud.

El retraso no abre un incidente; solo la caída lo hace. Si la comprobación se retrasa, el inicio de la caída sigue siendo el vencimiento esperado más el margen, no la hora posterior de la comprobación. Las horas usan la zona de la cuenta o la del navegador si se eligió en Preferencias.

La duración mide el tiempo entre recepción del inicio y del final, no latencia HTTP. Un éxito simple conserva la duración anterior o la deja desconocida. La tasa de éxito describe muestras guardadas, no disponibilidad continua. Señales repetidas del mismo estado pueden registrarse una vez por intervalo.

## Valores privados y límites

Envíe un objeto JSON de hasta 10 KiB. El `runId` opcional admite 64 letras o dígitos ASCII, guiones bajos, puntos, dos puntos o guiones. Los metadatos opcionales solo admiten `environment` y `version`, cada uno con hasta 64 letras, dígitos, guiones bajos, puntos o guiones. No envíe registros ni resultados privados. Repetir un ID no repite el resultado; un final con ID necesita un inicio existente. Use IDs nuevos para tareas nuevas, pues solo se conservan los recientes.

Pausar omite comprobaciones de ausencia y notificaciones; los resultados recibidos aún pueden cambiar la salud. El mantenimiento pausa alertas, no mediciones. Importar y exportar transfiere configuración sin tokens ni historial; las plantillas HTTP y los enlaces compartidos no copian heartbeats.

## Solución de problemas

Para 404, revise la ruta y el token actual. Para 400, revise JSON; para 413, reduzca su tamaño. Para 409, envíe primero un inicio con el mismo ID. Para 429 o 503, respete `Retry-After`; cada token admite hasta 120 solicitudes por minuto. Si continúa Tarde o Caído, compare el último éxito con el plazo y compruebe que la tarea lo envió.

## Temas relacionados

- [Vistas personales guardadas y grupos](/dashboard/help/saved-views)
- [Comprobaciones HTTP avanzadas](/dashboard/help/http-checks)
- [Objetivos de fiabilidad y contexto de eventos](/dashboard/help/reliability)
- [Comunicación en la página de estado pública](/dashboard/help/status-communication)
