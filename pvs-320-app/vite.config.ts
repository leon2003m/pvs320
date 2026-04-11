import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig, loadEnv } from 'vite';

type HttpsMaterial = {
  cert: Buffer;
  key: Buffer;
};

function collectSubjectAltNames() {
  const names = new Set<string>(['DNS:localhost', 'IP:127.0.0.1']);
  const hostname = os.hostname().trim();

  if (hostname) {
    names.add(`DNS:${hostname}`);
  }

  const networkInterfaces = os.networkInterfaces();
  for (const entries of Object.values(networkInterfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal) continue;
      if (entry.family === 'IPv4') {
        names.add(`IP:${entry.address}`);
      }
    }
  }

  return Array.from(names).join(',');
}

function ensureHttpsMaterial(rootDir: string): HttpsMaterial {
  const certDir = path.resolve(rootDir, '.cert');
  const keyPath = path.join(certDir, 'localhost-key.pem');
  const certPath = path.join(certDir, 'localhost-cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    fs.mkdirSync(certDir, { recursive: true });

    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-sha256',
        '-days',
        '3650',
        '-subj',
        '/CN=localhost',
        '-addext',
        `subjectAltName=${collectSubjectAltNames()}`,
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { stdio: 'ignore' },
    );
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

function bleLogPlugin(rootDir: string): Plugin {
  const logDir = path.resolve(rootDir, '.logs');
  const logPath = path.join(logDir, 'ble-live.log');

  fs.mkdirSync(logDir, { recursive: true });

  return {
    name: 'ble-live-log-sink',
    configureServer(server) {
      server.middlewares.use('/__logs/ble', (req, res) => {
        if (req.method === 'GET') {
          const body = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(body);
          return;
        }

        if (req.method === 'DELETE') {
          fs.writeFileSync(logPath, '');
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }

        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          try {
            const payload = JSON.parse(raw || '{}') as {
              timestamp?: number;
              type?: string;
              message?: string;
              state?: string;
            };

            const line = JSON.stringify({
              ts: payload.timestamp ?? Date.now(),
              type: payload.type ?? 'info',
              state: payload.state ?? 'unknown',
              message: payload.message ?? '',
            });

            fs.appendFileSync(logPath, `${line}\n`);
            res.statusCode = 204;
            res.end();
          } catch {
            res.statusCode = 400;
            res.end('Invalid JSON');
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const https = ensureHttpsMaterial(process.cwd());
  const rootDir = process.cwd();

  return {
    plugins: [react(), tailwindcss(), bleLogPlugin(rootDir)],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      https,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify; file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
