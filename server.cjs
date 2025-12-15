const http = require("http");
const next = require("next");

const dev = true;
const hostname = "localhost";
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  http.createServer((req, res) => {
    handle(req, res);
  }).listen(port, (err) => {
    if (err) throw err;
    console.log(`🚀 Custom Next.js server running on http://localhost:${port}`);
  });
});
