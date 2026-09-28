import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const userAgent = "SalesPatriot/0.1 (DIBBS RFQ synchronization)";

export class DibbsClient {
  private readonly cookies = new Map<string, Map<string, string>>();
  private readonly consentLocks = new Map<string, Promise<void>>();

  async getText(url: string): Promise<string> {
    const response = await this.request(url);
    if (!response.ok) throw new Error(`DIBBS returned ${response.status} for ${url}`);
    return response.text();
  }

  async postForm(url: string, form: URLSearchParams): Promise<string> {
    const response = await this.request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    if (!response.ok) throw new Error(`DIBBS returned ${response.status} for ${url}`);
    return response.text();
  }

  async download(
    url: string,
    destination: string,
    force = false,
    onProgress?: (received: number, total: number) => void,
  ): Promise<void> {
    if (!force && fs.existsSync(destination) && fs.statSync(destination).size > 0) return;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.part`;
    const response = await this.request(url, {}, 30 * 60_000);
    if (!response.ok || !response.body) {
      throw new Error(`DIBBS returned ${response.status} for ${url}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      throw new Error(`Expected a file from DIBBS but received HTML for ${url}`);
    }
    const total = Number(response.headers.get("content-length")) || 0;
    let received = 0;
    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        onProgress?.(received, total);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
        counter,
        fs.createWriteStream(temporaryPath),
      );
      fs.renameSync(temporaryPath, destination);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  async request(url: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    let response = await this.fetchFollowingRedirects(url, init, 0, timeoutMs);
    if (await isConsentPage(response)) {
      const origin = new URL(response.url).origin;
      let lock = this.consentLocks.get(origin);
      if (!lock) {
        lock = this.acceptConsent(response.clone()).finally(() => this.consentLocks.delete(origin));
        this.consentLocks.set(origin, lock);
      }
      await lock;
      response = await this.fetchFollowingRedirects(url, init, 0, timeoutMs);
    }
    return response;
  }

  private async acceptConsent(response: Response) {
    const html = await response.text();
    const action = html.match(/<form[^>]+action=["']([^"']+)["']/i)?.[1];
    if (!action) throw new Error(`Could not accept the DIBBS consent page at ${response.url}`);
    const form = hiddenFormFields(html);
    form.set("butAgree", "OK");
    await this.fetchFollowingRedirects(new URL(decodeHtml(action), response.url).toString(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
  }

  private async fetchFollowingRedirects(
    url: string,
    init: RequestInit,
    redirects = 0,
    timeoutMs = 30_000,
  ): Promise<Response> {
    if (redirects > 8) throw new Error(`Too many redirects while fetching ${url}`);
    const target = new URL(url);
    const headers = new Headers(init.headers);
    headers.set("user-agent", userAgent);
    headers.set("accept", headers.get("accept") ?? "*/*");
    const cookie = this.cookieHeader(target.hostname);
    if (cookie) headers.set("cookie", cookie);

    let response: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      try {
        response = await fetch(target, { ...init, headers, signal, redirect: "manual" });
      } catch (error) {
        if (attempt === 2) throw error;
        await wait(500 * 2 ** attempt);
        continue;
      }
      this.captureCookies(target.hostname, response);
      if (response.status !== 429 && response.status < 500) break;
      await response.body?.cancel();
      await wait(500 * 2 ** attempt);
    }
    if (!response) throw new Error(`No response from DIBBS for ${url}`);

    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      const nextUrl = new URL(location, target).toString();
      const nextInit = response.status === 307 || response.status === 308 ? init : { method: "GET" };
      return this.fetchFollowingRedirects(nextUrl, nextInit, redirects + 1, timeoutMs);
    }
    return response;
  }

  private captureCookies(hostname: string, response: Response) {
    const jar = this.cookies.get(hostname) ?? new Map<string, string>();
    for (const rawCookie of response.headers.getSetCookie()) {
      const pair = rawCookie.split(";", 1)[0] ?? "";
      const separator = pair.indexOf("=");
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) jar.set(name, value);
      else jar.delete(name);
    }
    this.cookies.set(hostname, jar);
  }

  private cookieHeader(hostname: string) {
    return [...(this.cookies.get(hostname) ?? [])]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

export function hiddenFormFields(html: string): URLSearchParams {
  const fields = new URLSearchParams();
  for (const input of html.matchAll(/<input\b[^>]*>/gi)) {
    const attributes = parseAttributes(input[0]);
    if (attributes.type?.toLowerCase() !== "hidden" || !attributes.name) continue;
    fields.append(attributes.name, decodeHtml(attributes.value ?? ""));
  }
  return fields;
}

function parseAttributes(tag: string) {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

async function isConsentPage(response: Response) {
  if (!(response.headers.get("content-type") ?? "").includes("text/html")) return false;
  const html = await response.clone().text();
  return html.includes("Department of Defense (DoD) Warning and Consent") && html.includes("butAgree");
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
