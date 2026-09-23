// A dev server that dies mid-crawl. Serves test/fixtures/site on argv[2]; after argv[3] responses
// (the readiness probe counts) it prints a last words line to stderr and then, per argv[4]:
//   exit     exits with code 1, like a runtime that crashed outright;
//   hang-up  closes the port but stays alive, like a supervisor whose worker process died.
import { createSiteServer } from "./serve-site.mjs";

const port = Number(process.argv[2] ?? 0);
const budget = Number(process.argv[3] ?? 10);
const mode = process.argv[4] ?? "exit";
let served = 0;
const sockets = new Set();
const server = createSiteServer();
server.on("connection", (socket) => {
	sockets.add(socket);
	socket.on("close", () => sockets.delete(socket));
});
server.on("request", (_req, res) => {
	res.on("finish", () => {
		served++;
		if (served !== budget) return;
		console.error(`kaboom: crashed after ${served} request(s)`);
		if (mode === "exit") process.exit(1);
		server.close();
		for (const socket of sockets) socket.destroy();
		setInterval(() => {}, 1 << 30);
	});
});
server.listen(port, "127.0.0.1", () => {
	console.log(`http://127.0.0.1:${server.address().port}`);
});
