import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DibbsClient } from "./dibbs-client.js";

test("resumes a retained partial download with a byte range", async () => {
  let requestedRange: string | undefined;
  const server = http.createServer((request, response) => {
    requestedRange = request.headers.range;
    response.writeHead(206, {
      "content-type": "application/zip",
      "content-length": "5",
      "content-range": "bytes 6-10/11",
    });
    response.end("world");
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dibbs-download-test-"));
  const destination = path.join(directory, "archive.zip");
  fs.writeFileSync(`${destination}.part`, "hello ");

  try {
    const url = await listen(server);
    await new DibbsClient().download(url, destination);
    assert.equal(requestedRange, "bytes=6-");
    assert.equal(fs.readFileSync(destination, "utf8"), "hello world");
    assert.equal(fs.existsSync(`${destination}.part`), false);
  } finally {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("retains an interrupted download for the next resume", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/zip",
      "content-length": "10",
    });
    response.write("abc");
    setTimeout(() => response.destroy(), 25);
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dibbs-download-test-"));
  const destination = path.join(directory, "archive.zip");

  try {
    const url = await listen(server);
    await assert.rejects(() => new DibbsClient().download(url, destination));
    assert.equal(fs.readFileSync(`${destination}.part`, "utf8"), "abc");
    assert.equal(fs.existsSync(destination), false);
  } finally {
    server.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

async function listen(server: http.Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");
  return `http://127.0.0.1:${address.port}/archive.zip`;
}
