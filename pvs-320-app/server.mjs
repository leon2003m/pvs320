import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);
const distDir = path.join(__dirname, 'dist');
const defaultLogPath = path.join('/tmp', 'ble-live.log');
const logPath = process.env.BLE_LOG_PATH || defaultLogPath;
const logDir = path.dirname(logPath);

fs.mkdirSync(logDir, { recursive: true });

app.use(express.json({ limit: '64kb' }));

app.use('/__logs/ble', (req, res) => {
  if (req.method === 'GET') {
    const body = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(body);
    return;
  }

  if (req.method === 'DELETE') {
    fs.writeFileSync(logPath, '');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).end('Method Not Allowed');
    return;
  }

  try {
    const payload = req.body || {};
    const line = JSON.stringify({
      ts: payload.timestamp ?? Date.now(),
      type: payload.type ?? 'info',
      state: payload.state ?? 'unknown',
      message: payload.message ?? '',
    });

    fs.appendFileSync(logPath, `${line}\n`);
    res.status(204).end();
  } catch {
    res.status(400).end('Invalid JSON');
  }
});

app.use(express.static(distDir));

app.get('*', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`pvs-320-app listening on http://0.0.0.0:${port}`);
});
