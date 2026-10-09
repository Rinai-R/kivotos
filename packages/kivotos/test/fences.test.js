import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Config,
  coverViewport,
  credentialedManifest,
  injectOwnsHost,
  injectStorageNamespace,
  sameSite,
} from "../index.js";
import { forwardHeaders, HOP_HEADER, hostnameOf, mountLocation, remoteIp } from "../proxy.js";

const AUTHORITY = "100.64.0.1:7380";

test("sameSite refuses requests a foreign page initiated", () => {
  // Regression: the listener strips Origin before forwarding, so it must apply
  // this fence itself; a WebSocket handshake is not subject to CORS.
  assert.equal(sameSite({ host: AUTHORITY }), true);
  assert.equal(sameSite({ host: AUTHORITY, origin: `http://${AUTHORITY}` }), true);
  assert.equal(sameSite({ host: AUTHORITY, origin: "http://evil.example" }), false);
  assert.equal(sameSite({ host: AUTHORITY, origin: "http://100.64.0.1:9999" }), false);
  assert.equal(sameSite({ host: AUTHORITY, origin: "null" }), false);
  assert.equal(sameSite({ host: AUTHORITY, "sec-fetch-site": "cross-site" }), false);
  assert.equal(
    sameSite({ host: AUTHORITY, origin: `http://${AUTHORITY}`, "sec-fetch-site": "cross-site" }),
    false,
  );
});

test("forwardHeaders drops the browser's origin and credentials, pins the upstream authority", () => {
  const out = forwardHeaders(
    {
      host: "attacker.example",
      origin: "http://attacker.example",
      referer: "http://attacker.example/x",
      cookie: "dsh-auth-a=browser",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      accept: "text/html",
    },
    { host: "127.0.0.1", port: 3000, authority: "127.0.0.1:3000", cookie: "dsh-auth-b=hop" },
  );
  assert.deepEqual(out, {
    accept: "text/html",
    host: "127.0.0.1:3000",
    cookie: "dsh-auth-b=hop",
  });
});

test("forwardHeaders sends no cookie when the hop holds none", () => {
  const out = forwardHeaders(
    { host: "x", cookie: "dsh-auth-a=browser" },
    { host: "100.64.0.2", port: 7380, authority: "100.64.0.2:7380" },
  );
  assert.equal("cookie" in out, false);
});

test("a peer mount marks its hop and a listener passes the mark through", () => {
  // Regression: without the mark, /kivotos/peer/b/kivotos/peer/a/ chained A -> B -> A.
  const peer = { host: "100.64.0.2", port: 7380, authority: "100.64.0.2:7380", hop: true };
  assert.equal(forwardHeaders({ host: "x" }, peer)[HOP_HEADER], "1");
  const loopback = { host: "127.0.0.1", port: 3000, authority: "127.0.0.1:3000" };
  assert.equal(forwardHeaders({ host: "x" }, loopback)[HOP_HEADER], undefined);
  assert.equal(forwardHeaders({ host: "x", [HOP_HEADER]: "1" }, loopback)[HOP_HEADER], "1");
});

test("mountLocation rewrites only root-relative redirects", () => {
  const prefix = "/kivotos/peer/b";
  assert.equal(mountLocation("/", prefix), "/kivotos/peer/b/");
  assert.equal(mountLocation("/a?b=1", prefix), "/kivotos/peer/b/a?b=1");
  assert.equal(mountLocation("//evil.example/x", prefix), "//evil.example/x");
  assert.equal(mountLocation("https://example.com/", prefix), "https://example.com/");
  assert.equal(mountLocation("relative", prefix), "relative");
  assert.equal(mountLocation("/a", ""), "/a");
});

test("hostnameOf normalizes Host headers", () => {
  assert.equal(hostnameOf("Node.Tail1234.ts.net.:7380"), "node.tail1234.ts.net");
  assert.equal(hostnameOf("100.64.0.1:7380"), "100.64.0.1");
  assert.equal(hostnameOf("[fd7a:115c::1]:7380"), "fd7a:115c::1");
  assert.equal(hostnameOf(undefined), "");
});

test("remoteIp unwraps IPv4-mapped addresses", () => {
  assert.equal(remoteIp("::ffff:100.64.0.1"), "100.64.0.1");
  assert.equal(remoteIp("fd7a:115c::1"), "fd7a:115c::1");
  assert.equal(remoteIp(undefined), "");
});

test("head injections land before every document script", () => {
  const html = '<!doctype html><html><head lang="en"><script src="app.js"></script></head></html>';
  for (const out of [injectOwnsHost(html), injectStorageNamespace(html, "b")]) {
    assert.ok(out.indexOf("<script>") < out.indexOf('<script src="app.js">'));
    assert.ok(out.startsWith('<!doctype html><html><head lang="en"><script>'));
  }
});

test("injectStorageNamespace cannot be broken out of by a peer id", () => {
  const out = injectStorageNamespace("<head></head>", '"</script><script>alert(1)//');
  assert.equal(out.split("</script>").length, 2);
});

test("index rewrites match the dsh 0.2.1-alpha.1 index.html markup", () => {
  const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
  assert.match(coverViewport(viewport), /viewport-fit=cover/);
  const manifest = '<link rel="manifest" href="./manifest.webmanifest" />';
  assert.match(credentialedManifest(manifest), /crossorigin="use-credentials"/);
});

test("Config fills defaults and reports invalid rows", () => {
  const ok = Config["~standard"].validate({ port: 7400 });
  assert.ok("value" in ok);
  assert.equal(ok.value.port, 7400);
  assert.equal(ok.value.allowSelf, false);
  assert.equal(ok.value.discover, true);
  assert.deepEqual(ok.value.staticPeers, []);

  const bad = Config["~standard"].validate({
    port: 70000,
    tls: "maybe",
    staticPeers: [{ id: "a/b", host: "", port: 1.5 }],
  });
  assert.ok("issues" in bad);
  assert.deepEqual(bad.issues.map((issue) => issue.path.join(".")).toSorted(), [
    "port",
    "staticPeers.0",
    "staticPeers.0",
    "staticPeers.0",
    "tls",
  ]);
});
