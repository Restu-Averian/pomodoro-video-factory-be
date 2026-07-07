require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const healthRoutes = require('./routes/health');

const app = express();

app.use(cors());
app.use(express.json());

// Static serving for outputs
app.use('/outputs', express.static(path.join(__dirname, '../../data/outputs')));

// Routes
app.use('/api', healthRoutes);
app.use('/api/projects', require('./routes/projects'));
app.use('/api', require('./routes/render'));

module.exports = app;
