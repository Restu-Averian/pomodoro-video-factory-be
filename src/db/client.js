const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_FILE ? path.resolve(__dirname, '../../', process.env.DB_FILE) : path.join(__dirname, '../../../data/pomodoro.db');

const db = new Database(dbPath, { verbose: console.log });

module.exports = db;
