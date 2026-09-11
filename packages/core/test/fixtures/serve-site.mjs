// Serves test/fixtures/site on the port given as argv[2] (default 0). Prints the URL on stdout.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "site");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".xml": "application/xml", ".txt": "text/plain", ".png": "image/png", ".js": "text/javascript" };

export function createSiteServer() {
	return createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		let path = url.pathname;
		if (path === "/") path = "/index.html";
		if (path === "/redirect-once") {
			res.writeHead(302, { location: "/about.html" });
			return res.end();
		}
		if (path === "/redirect-twice") {
			res.writeHead(302, { location: "/redirect-once" });
			return res.end();
		}
		const file = normalize(join(root, path));
		if (!file.startsWith(root)) {
			res.writeHead(403);
			return res.end();
		}
		try {
			const body = await readFile(file);
			res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "content-length": body.length });
			res.end(body);
		} catch {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
		}
	});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const port = Number(process.argv[2] ?? 0);
	const server = createSiteServer();
	server.listen(port, "127.0.0.1", () => {
		console.log(`http://127.0.0.1:${server.address().port}`);
	});
}
