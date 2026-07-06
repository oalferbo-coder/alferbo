require('dotenv').config();
const path = require('path');
const express = require('express');
const cron = require('node-cron');
const db = require('./db');
const { sendWhatsApp, normalizePhone } = require('./whatsapp');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // webhooks de Twilio llegan como form-urlencoded
app.use(express.static(path.join(__dirname, '..', 'public')));

const PRIORIDADES = { 1: 'Alta', 2: 'Media', 3: 'Baja' };

// ---------- Roles ----------
app.get('/api/roles', (req, res) => {
  res.json(db.prepare('SELECT * FROM roles ORDER BY name').all());
});

app.post('/api/roles', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'name requerido' });
  try {
    const info = db.prepare('INSERT INTO roles (name, description) VALUES (?, ?)')
      .run(name.trim().toLowerCase(), description || null);
    res.status(201).json(db.prepare('SELECT * FROM roles WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: 'ese rol ya existe' });
  }
});

// ---------- Personal ----------
app.get('/api/staff', (req, res) => {
  res.json(db.prepare(`
    SELECT s.*, r.name AS role_name FROM staff s
    JOIN roles r ON r.id = s.role_id
    ORDER BY s.active DESC, s.name
  `).all());
});

app.post('/api/staff', (req, res) => {
  const { name, phone, role_id } = req.body;
  if (!name || !phone || !role_id) return res.status(400).json({ error: 'name, phone y role_id requeridos' });
  try {
    const info = db.prepare('INSERT INTO staff (name, phone, role_id) VALUES (?, ?, ?)')
      .run(name.trim(), normalizePhone(phone), role_id);
    res.status(201).json(db.prepare('SELECT * FROM staff WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: 'ese telefono ya esta registrado' });
  }
});

app.patch('/api/staff/:id', (req, res) => {
  const { active, role_id, name } = req.body;
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.params.id);
  if (!staff) return res.status(404).json({ error: 'no existe' });
  db.prepare('UPDATE staff SET active = ?, role_id = ?, name = ? WHERE id = ?').run(
    active !== undefined ? (active ? 1 : 0) : staff.active,
    role_id ?? staff.role_id,
    name ?? staff.name,
    staff.id,
  );
  res.json(db.prepare('SELECT * FROM staff WHERE id = ?').get(staff.id));
});

// ---------- Tareas ----------
app.get('/api/tasks', (req, res) => {
  const { status, assigned_to } = req.query;
  let sql = `
    SELECT t.*, s.name AS assigned_name, s.phone AS assigned_phone, r.name AS assigned_role
    FROM tasks t
    LEFT JOIN staff s ON s.id = t.assigned_to
    LEFT JOIN roles r ON r.id = s.role_id
    WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (assigned_to) { sql += ' AND t.assigned_to = ?'; params.push(assigned_to); }
  sql += ' ORDER BY t.priority, t.created_at';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/tasks', async (req, res) => {
  const { sector, description, priority, cost_estimate, assigned_to, due_date } = req.body;
  if (!description) return res.status(400).json({ error: 'description requerida' });
  const info = db.prepare(`
    INSERT INTO tasks (sector, description, priority, cost_estimate, assigned_to, due_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sector || null, description, priority || 2, cost_estimate || null, assigned_to || null, due_date || null);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid);
  db.prepare("INSERT INTO task_logs (task_id, note, status, source) VALUES (?, 'Tarea creada', 'pendiente', 'app')").run(task.id);

  if (task.assigned_to) await notifyAssignment(task);
  res.status(201).json(task);
});

app.patch('/api/tasks/:id', async (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'no existe' });
  const { status, assigned_to, priority, due_date, note } = req.body;
  const newAssignee = assigned_to !== undefined ? assigned_to : task.assigned_to;
  db.prepare('UPDATE tasks SET status = ?, assigned_to = ?, priority = ?, due_date = ? WHERE id = ?').run(
    status ?? task.status,
    newAssignee,
    priority ?? task.priority,
    due_date ?? task.due_date,
    task.id,
  );
  db.prepare('INSERT INTO task_logs (task_id, note, status, source) VALUES (?, ?, ?, ?)')
    .run(task.id, note || 'Actualizacion desde la app', status ?? task.status, 'app');

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id);
  if (assigned_to !== undefined && assigned_to && assigned_to !== task.assigned_to) {
    await notifyAssignment(updated);
  }
  res.json(updated);
});

app.get('/api/tasks/:id/logs', (req, res) => {
  res.json(db.prepare('SELECT * FROM task_logs WHERE task_id = ? ORDER BY created_at').all(req.params.id));
});

// ---------- WhatsApp ----------
async function notifyAssignment(task) {
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(task.assigned_to);
  if (!staff) return;
  const lines = [
    `Nueva tarea #${task.id} (${PRIORIDADES[task.priority] || 'Media'})`,
    task.sector ? `Sector: ${task.sector}` : null,
    `Trabajo: ${task.description}`,
    task.due_date ? `Fecha limite: ${task.due_date}` : null,
    '',
    `Responde "TOMO ${task.id}" al empezar, "LISTO ${task.id}" al terminar,`,
    `o "PROBLEMA ${task.id} <detalle>" si algo lo impide.`,
  ].filter(l => l !== null);
  try {
    await sendWhatsApp(staff.phone, lines.join('\n'));
    db.prepare("INSERT INTO task_logs (task_id, note, source) VALUES (?, 'Asignacion enviada por WhatsApp', 'whatsapp')").run(task.id);
  } catch (e) {
    console.error('Error enviando WhatsApp:', e.message);
  }
}

// Webhook de mensajes entrantes de Twilio (configurar la URL en la consola de Twilio).
app.post('/webhook/whatsapp', async (req, res) => {
  const from = (req.body.From || '').replace('whatsapp:', '');
  const body = (req.body.Body || '').trim();
  const staff = db.prepare('SELECT * FROM staff WHERE phone = ?').get(normalizePhone(from));

  let reply;
  if (!staff) {
    reply = 'Tu numero no esta registrado en el sistema. Habla con la administracion.';
  } else {
    reply = await handleIncoming(staff, body);
  }
  res.type('text/xml').send(`<Response><Message>${reply}</Message></Response>`);
});

async function handleIncoming(staff, body) {
  const match = body.match(/^(TOMO|LISTO|PROBLEMA)\s+(\d+)\s*(.*)$/i);
  if (!match) {
    const pending = myPendingTasks(staff.id);
    if (/^tareas$/i.test(body)) return formatTaskList(staff, pending);
    return 'Comandos: "TAREAS" (ver pendientes), "TOMO n", "LISTO n", "PROBLEMA n detalle".';
  }
  const [, cmdRaw, idRaw, detail] = match;
  const cmd = cmdRaw.toUpperCase();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(Number(idRaw));
  if (!task || task.assigned_to !== staff.id) return `La tarea #${idRaw} no esta asignada a vos.`;

  const map = { TOMO: 'en_curso', LISTO: 'terminada', PROBLEMA: 'bloqueada' };
  const newStatus = map[cmd];
  db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(newStatus, task.id);
  db.prepare('INSERT INTO task_logs (task_id, note, status, source) VALUES (?, ?, ?, ?)')
    .run(task.id, detail || `Reportado por WhatsApp: ${cmd}`, newStatus, 'whatsapp');

  if (cmd === 'PROBLEMA' && process.env.ENCARGADO_WHATSAPP_TO) {
    try {
      await sendWhatsApp(process.env.ENCARGADO_WHATSAPP_TO,
        `PROBLEMA en tarea #${task.id} (${task.sector || 'sin sector'}): ${task.description}\nReportado por ${staff.name}: ${detail || 'sin detalle'}`);
    } catch (e) { console.error('No se pudo avisar al encargado:', e.message); }
  }

  if (cmd === 'LISTO') return `Perfecto, tarea #${task.id} marcada como terminada. Gracias!`;
  if (cmd === 'TOMO') return `Anotado, tarea #${task.id} en curso.`;
  return `Registrado el problema en la tarea #${task.id}. Se aviso al encargado.`;
}

function myPendingTasks(staffId) {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE assigned_to = ? AND status IN ('pendiente','en_curso','bloqueada')
    ORDER BY priority, created_at
  `).all(staffId);
}

function formatTaskList(staff, tasks) {
  if (!tasks.length) return `Hola ${staff.name}, no tenes tareas pendientes hoy.`;
  const lines = tasks.map(t =>
    `#${t.id} [${PRIORIDADES[t.priority]}] ${t.sector ? t.sector + ' - ' : ''}${t.description} (${t.status})`);
  return `Hola ${staff.name}, tus tareas de hoy:\n${lines.join('\n')}`;
}

// ---------- Seguimiento diario ----------
// Idea tomada del plan de mantenimiento del colegio: asignar tareas diariamente
// a cada uno y llevar control de los trabajos. Cada manana se envia a cada
// persona activa el listado de sus tareas pendientes.
async function dailyFollowup() {
  const staffList = db.prepare('SELECT * FROM staff WHERE active = 1').all();
  for (const staff of staffList) {
    const tasks = myPendingTasks(staff.id);
    if (!tasks.length) continue;
    try {
      await sendWhatsApp(staff.phone, formatTaskList(staff, tasks) +
        '\n\nResponde "TOMO n", "LISTO n" o "PROBLEMA n detalle" a lo largo del dia.');
    } catch (e) { console.error(`Seguimiento a ${staff.name} fallo:`, e.message); }
  }
  console.log(`[seguimiento diario] enviado a ${staffList.length} personas`);
}

cron.schedule(process.env.DAILY_FOLLOWUP_CRON || '0 7 * * *', dailyFollowup);

// Disparo manual del seguimiento (util para pruebas o refuerzos a mitad de dia).
app.post('/api/followup/run', async (req, res) => {
  await dailyFollowup();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Mantenimiento app en http://localhost:${PORT}`));
}

module.exports = app;
