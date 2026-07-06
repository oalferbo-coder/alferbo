const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'mantenimiento.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sector TEXT,
  description TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 2,
  cost_estimate REAL,
  assigned_to INTEGER REFERENCES staff(id),
  status TEXT NOT NULL DEFAULT 'pendiente',
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  note TEXT,
  status TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const defaultRoles = [
  ['cadete', 'Mensajeria, compras y tareas de apoyo'],
  ['encargado_mantenimiento', 'Supervisa al personal de mantenimiento y servicio'],
  ['oficial_mantenimiento', 'Tareas de mantenimiento ordinario y extraordinario'],
  ['limpieza', 'Servicio de limpieza'],
  ['portero', 'Recepcion y control de acceso'],
  ['sereno', 'Vigilancia nocturna'],
];

const insertRole = db.prepare('INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)');
for (const [name, description] of defaultRoles) insertRole.run(name, description);

module.exports = db;
