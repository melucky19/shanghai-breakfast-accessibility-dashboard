import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  handleBreakfastRequest,
  handlePlaceSearchRequest,
} from "./breakfast-api.mjs";

function parseEnv(source) {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

let env = {};
try {
  env = parseEnv(await fs.readFile(path.resolve(".env.local"), "utf8"));
} catch {
  env = {};
}

const webServiceKey =
  process.env.AMAP_WEB_SERVICE_KEY || env.AMAP_WEB_SERVICE_KEY || "";
const port = Number(process.env.PORT || 8787);
const distDirectory = path.resolve("dist");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname === "/api/breakfast-pois") {
    await handleBreakfastRequest(request, response, { webServiceKey });
    return;
  }
  if (requestUrl.pathname === "/api/place-search") {
    await handlePlaceSearchRequest(request, response, { webServiceKey });
    return;
  }

  let relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  if (!relativePath || !path.extname(relativePath)) relativePath = "index.html";
  const filePath = path.resolve(distDirectory, relativePath);
  if (!filePath.startsWith(distDirectory)) {
    response.statusCode = 403;
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    response.statusCode = 200;
    response.setHeader(
      "Content-Type",
      contentTypes[path.extname(filePath)] || "application/octet-stream"
    );
    response.end(content);
  } catch {
    const fallback = await fs.readFile(path.join(distDirectory, "index.html"));
    response.statusCode = 200;
    response.setHeader("Content-Type", contentTypes[".html"]);
    response.end(fallback);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Breakfast dashboard: http://localhost:${port}/`);
});
