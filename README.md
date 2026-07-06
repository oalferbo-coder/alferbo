# Alferbo Mantenimiento

App de gestion de tareas de mantenimiento y servicios, con **seguimiento diario**
coordinado por **WhatsApp**. Basada en la forma de trabajo del plan de mantenimiento
del colegio: relevar necesidades, asignar tareas diariamente a cada persona y llevar
control de los trabajos.

## Que hace

- **Roles extensibles**: viene con `cadete`, `encargado_mantenimiento`,
  `oficial_mantenimiento`, `limpieza`, `portero` y `sereno`; se pueden crear mas
  desde el panel.
- **Personal**: cada persona tiene nombre, rol y numero de WhatsApp.
- **Tareas**: sector, descripcion, prioridad (Alta/Media/Baja), costo estimado,
  fecha limite y responsable. Al asignar, la persona recibe la tarea por WhatsApp.
- **Seguimiento diario**: todas las mananas (7:00 por defecto) cada persona activa
  recibe por WhatsApp su lista de tareas pendientes.
- **Respuestas por WhatsApp**: el personal contesta en el mismo chat:
  - `TAREAS` — ver sus pendientes
  - `TOMO 12` — marca la tarea #12 en curso
  - `LISTO 12` — la marca terminada
  - `PROBLEMA 12 falta material` — la marca bloqueada y avisa al encargado
- **Panel web** en `/` para gestionar todo y ver el estado.

## Correr localmente

```bash
npm install
cp .env.example .env   # completar credenciales de Twilio si se tienen
npm start              # http://localhost:3000
```

Sin credenciales de Twilio la app funciona en **modo simulacion**: los WhatsApp
salientes se imprimen en consola, util para probar.

## WhatsApp (Twilio)

1. Crear cuenta en Twilio y activar el sandbox de WhatsApp (o un numero productivo).
2. Completar en `.env`: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.
3. Configurar el webhook de mensajes entrantes del sandbox apuntando a
   `https://<tu-dominio>/webhook/whatsapp` (metodo POST).
4. Opcional: `ENCARGADO_WHATSAPP_TO` para que los `PROBLEMA` lleguen al encargado.

## API

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET/POST | `/api/roles` | Listar / crear roles |
| GET/POST/PATCH | `/api/staff`, `/api/staff/:id` | Personal |
| GET/POST/PATCH | `/api/tasks`, `/api/tasks/:id` | Tareas (PATCH notifica reasignaciones) |
| GET | `/api/tasks/:id/logs` | Historial de seguimiento de una tarea |
| POST | `/api/followup/run` | Disparar el seguimiento diario manualmente |
| POST | `/webhook/whatsapp` | Webhook de mensajes entrantes de Twilio |

Los datos se guardan en `data/mantenimiento.db` (SQLite, se crea solo).
