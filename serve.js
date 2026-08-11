// Servidor local simples, sem dependências externas.
// Uso: node serve.js [porta]
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = process.argv[2] || 8080;

const types = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/manifest+json',
  '.png': 'image/png',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.join(root, urlPath);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + filePath);
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log(`Servindo em http://localhost:${port}`));
