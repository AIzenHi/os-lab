#!/usr/bin/env node
// 零依赖静态服务器:服务 dist 构建产物,双击快捷方式即用
// 已有实例运行时不再重复启动,直接打开浏览器
import http from 'node:http';
import { connect } from 'node:net';
import { exec } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 4310;
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), 'dist');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2'
};

const noOpen = process.argv.includes('--no-open');

function openBrowser(url) {
  if (noOpen) return;
  if (process.platform === 'win32') exec(`start "" "${url}"`);
  else if (process.platform === 'darwin') exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

function checkExisting() {
  return new Promise((resolve) => {
    const s = connect(PORT, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => {
      s.destroy();
      resolve(false);
    });
  });
}

function startServer() {
  if (!existsSync(join(ROOT, 'index.html'))) {
    console.error('[os-lab] 未找到 dist/ 构建产物,请先在项目目录运行: npm run build');
    process.exit(1);
  }
  const server = http.createServer((req, res) => {
    let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    // 防目录穿越:解析后的路径必须仍在 dist 内
    const filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(normalize(ROOT))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    let isFile = false;
    try {
      isFile = existsSync(filePath) && statSync(filePath).isFile();
    } catch {
      isFile = false;
    }
    if (!isFile) {
      // SPA 回退到 index.html
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      createReadStream(join(ROOT, 'index.html')).pipe(res);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
    });
    createReadStream(filePath).pipe(res);
  });

  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      // 探测与监听之间被抢占:视为已有实例
      openBrowser(`http://localhost:${PORT}`);
      console.log('[os-lab] 服务器已在运行,已为你打开浏览器。');
      process.exit(0);
    }
    console.error('[os-lab] 启动失败:', e.message);
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[os-lab] 实验台运行中: http://localhost:${PORT}`);
    console.log('[os-lab] 关闭本窗口即可停止服务器。');
    openBrowser(`http://localhost:${PORT}`);
  });
}

const existing = await checkExisting();
if (existing) {
  openBrowser(`http://localhost:${PORT}`);
  console.log('[os-lab] 服务器已在运行,已为你打开浏览器。');
  process.exit(0);
}
startServer();
