import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";
import { bootResources } from "../src/cache.ts";
import {
  COMPAT_GLOBAL,
  compatReportOf,
  failedPoints,
  injectCompatReport,
  mergeCompat,
  PageVerdicts,
  type CompatReport,
} from "../src/dsh/compat.ts";
import { guardDesktopBoot } from "../src/dsh/desktop.ts";
import {
  PARTS,
  phoneStylesheet,
  probePhoneConversation,
  probePhoneLayout,
  probePhoneSettings,
  type FrameNode,
} from "../src/dsh/frame.ts";
import { bootGraphOf, coverViewport, credentialedManifest } from "../src/dsh/index-html.ts";
import {
  currentSession,
  injectStorageNamespace,
  probeSessionStore,
  selectSession,
} from "../src/dsh/sessions.ts";

/** The index dsh 0.2.1-rc.2 serves, byte for byte (`dsh --profile web`, fetched signed in). */
const PINNED = readFileSync(new URL("fixtures/dsh-0.2.1-rc.2.index.html", import.meta.url), "utf8");

/** The pinned index with one string replaced, the way an upstream change would. */
function altered(from: string, to: string): string {
  assert.ok(PINNED.includes(from), `the fixture has no ${from}`);
  return PINNED.replace(from, to);
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
const MANIFEST = '<link rel="manifest" href="./manifest.webmanifest" />';
const GATE = "(globalThis.__DSH_BOOT_READY__ ??= Promise.withResolvers()).resolve()";

test("every index rewrite applies to the index dsh 0.2.1-rc.2 serves", () => {
  const viewport = coverViewport(PINNED);
  assert.equal(viewport.probe.state, "ok");
  assert.match(viewport.html, /viewport-fit=cover/);
  const manifest = credentialedManifest(PINNED);
  assert.equal(manifest.probe.state, "ok");
  assert.match(manifest.html, /crossorigin="use-credentials"/);
  assert.equal(bootGraphOf(PINNED).probe.state, "ok");
  assert.equal(guardDesktopBoot(PINNED, "/kivotos/peer/b").probe.state, "ok");
  // The warm-up reads its targets from the same graph the probe accepted.
  assert.ok((bootResources(PINNED)?.targets.length ?? 0) > 0);
});

test("a changed index is served as dsh sent it, and says which markup moved", () => {
  for (const [rewrite, from, to, state] of [
    [coverViewport, VIEWPORT, '<meta name="viewport" content="width=device-width" />', "changed"],
    [coverViewport, VIEWPORT, "", "missing"],
    [credentialedManifest, MANIFEST, '<link rel="manifest" href="/app.webmanifest" />', "changed"],
    [credentialedManifest, MANIFEST, "", "missing"],
  ] as const) {
    const html = altered(from, to);
    const out = rewrite(html);
    assert.equal(out.probe.state, state, `${from} -> ${to}`);
    assert.equal(out.html, html, "a failed probe still rewrote the page");
  }
});

test("the desktop guard is installed whatever the gate, and reports a moved gate", () => {
  const moved = guardDesktopBoot(altered(GATE, "globalThis.__DSH_BOOT_READY__?.resolve()"), "/p");
  assert.equal(moved.probe.state, "changed");
  assert.ok(moved.html.includes("dshDesktopBoot"));
  const gone = guardDesktopBoot(PINNED.replaceAll("__DSH_BOOT_READY__", "__DSH_READY__"), "/p");
  assert.equal(gone.probe.state, "missing");
});

test("a boot graph of another shape turns the warm-up off instead of feeding it", () => {
  const graph = altered('"batches":', '"chunks":');
  assert.equal(bootGraphOf(graph).probe.state, "changed");
  assert.equal(bootResources(graph), undefined);
  const gone = PINNED.replace(/<script>globalThis\["__DSH_BOOT__"\] = .*?<\/script>/s, "");
  assert.equal(bootGraphOf(gone).probe.state, "missing");
});

test("only the failures travel to the page, and the page reads them back", () => {
  assert.equal(injectCompatReport(PINNED, { viewport: coverViewport(PINNED).probe }), PINNED);
  const broken = altered(MANIFEST, "");
  const report: CompatReport = {
    manifest: credentialedManifest(broken).probe,
    viewport: coverViewport(broken).probe,
  };
  const page = injectCompatReport(broken, report);
  const script = /<script>(Object\.assign\(globalThis\.__KIVOTOS_COMPAT__[^<]*)<\/script>/.exec(
    page,
  );
  assert.ok(script, "the report is not in the page");
  const realm: Record<string, unknown> = {};
  new Function("globalThis", script[1])(realm);
  assert.deepEqual(compatReportOf(realm[COMPAT_GLOBAL]), { manifest: report.manifest });
  // A reason cannot close the script that carries it.
  const hostile = injectCompatReport("<head></head>", {
    manifest: { state: "changed", reason: "</script><script>alert(1)</script>" },
  });
  assert.equal(hostile.split("</script>").length, 2);
});

test("anything in the page global that is not a probe is ignored", () => {
  assert.deepEqual(compatReportOf(undefined), {});
  assert.deepEqual(
    compatReportOf({
      viewport: { state: "broken", reason: "x" },
      manifest: { state: "missing" },
      unknown: { state: "missing", reason: "x" },
      "boot-graph": { state: "changed", reason: "moved" },
    }),
    { "boot-graph": { state: "changed", reason: "moved" } },
  );
});

test("two reports of one point keep the worse answer", () => {
  const ok = { state: "ok", reason: "" } as const;
  const changed = { state: "changed", reason: "" } as const;
  const missing = { state: "missing", reason: "" } as const;
  assert.deepEqual(mergeCompat({ viewport: ok }, { viewport: changed }), { viewport: changed });
  assert.deepEqual(mergeCompat({ viewport: missing }, { viewport: changed }), {
    viewport: missing,
  });
  assert.deepEqual(
    failedPoints(mergeCompat({ viewport: ok }, { manifest: missing })).map(({ point }) => point),
    ["manifest"],
  );
});

test("a page verdict settles on ok at once, on a failure only when it repeats, and then stays", () => {
  const ok = { state: "ok", reason: "" } as const;
  const changed = { state: "changed", reason: "mid-render" } as const;
  const verdicts = new PageVerdicts();
  // Nothing to judge yet, then one failure: neither settles.
  assert.equal(verdicts.read({}), false);
  assert.equal(verdicts.read({ "phone-settings": changed, "phone-layout": ok }), true);
  assert.deepEqual(verdicts.report(), { "phone-layout": ok });
  // A failure that does not repeat is forgotten.
  verdicts.read({ "phone-settings": ok });
  assert.deepEqual(verdicts.report(), { "phone-layout": ok, "phone-settings": ok });
  const failing = new PageVerdicts();
  failing.read({ "phone-layout": changed });
  failing.read({ "phone-layout": changed });
  assert.deepEqual(failing.report(), { "phone-layout": changed });
  // Settled is final: a later reading changes nothing.
  failing.read({ "phone-layout": ok });
  assert.deepEqual(failing.report(), { "phone-layout": changed });
});

/** A rendered element as the probes see it: tag, class, data attributes. */
interface Node {
  tag?: string;
  attrs?: Record<string, string>;
  children?: Node[];
}

/** The selector shapes the probes use: a tag, `[attr]`, `[attr="v"]`, `[class*="part"]`. */
function matches(node: Node, selector: string): boolean {
  const attrs = node.attrs ?? {};
  const contains = /^\[class\*="(.+)"\]$/.exec(selector);
  if (contains !== null) return (attrs.class ?? "").includes(contains[1]);
  const attr = /^\[([\w-]+)(?:="(.*)")?\]$/.exec(selector);
  if (attr !== null)
    return attr[1] in attrs && (attr[2] === undefined || attrs[attr[1]] === attr[2]);
  return (node.tag ?? "div") === selector;
}

/** An element both the frame and the Session probes can read. */
interface TestNode extends FrameNode {
  readonly children: TestNode[];
  querySelector(selectors: string): TestNode | null;
  getAttribute(name: string): string | null;
}

function element(node: Node, parent: TestNode | null): TestNode {
  const self: TestNode = {
    parentElement: parent,
    tagName: (node.tag ?? "div").toUpperCase(),
    get children() {
      return (node.children ?? []).map((each) => element(each, self));
    },
    matches: (selector) => matches(node, selector),
    querySelector: (selector) => find(node.children ?? [], selector, self),
    getAttribute: (name) => node.attrs?.[name] ?? null,
  };
  return self;
}

function find(nodes: Node[], selector: string, parent: TestNode): TestNode | null {
  for (const node of nodes) {
    const self = element(node, parent);
    if (matches(node, selector)) return self;
    const deeper = find(node.children ?? [], selector, self);
    if (deeper !== null) return deeper;
  }
  return null;
}

function pageOf(...roots: Node[]): { querySelector(selectors: string): TestNode | null } {
  const top = element({ children: roots }, null);
  return { querySelector: (selector) => top.querySelector(selector) };
}

const cls = (value: string): Record<string, string> => ({ class: value });

/**
 * dsh 0.2.1-rc.2's AppFrame with a conversation, as rendered (ui-layout
 * AppFrame.module.css `pI_x6G_`, ui-sidebar `hHd-Xa_`, ui-conversation `wSkVaW_`).
 */
function frame(overrides: { column?: string; header?: string; composer?: string } = {}): Node {
  const conversation: Node = {
    attrs: {
      ...cls("wSkVaW_body"),
      "data-conversation-content": "",
      "data-conversation-session": "s1",
    },
    children: [
      {
        attrs: cls(overrides.header ?? "wSkVaW_header wSkVaW_headerBlank"),
        children: [{ attrs: { "data-conversation-header-leading": "" } }],
      },
      {
        attrs: { ...cls("wSkVaW_scrollBody"), "data-conversation-scroll": "" },
        children: [
          {
            attrs: {
              ...cls(overrides.composer ?? "wSkVaW_composerSeat"),
              "data-composer-seat": "",
            },
          },
        ],
      },
    ],
  };
  return {
    attrs: cls("pI_x6G_frame"),
    children: [
      {
        attrs: cls(overrides.column ?? "pI_x6G_sidebarCol"),
        children: [{ children: [{ attrs: cls("hHd-Xa_root") }] }],
      },
      { attrs: cls("pI_x6G_centerCol"), children: [conversation] },
      { attrs: cls("pI_x6G_rightbarCol") },
      { attrs: { ...cls("pI_x6G_overlayLayer"), "data-shell-overlay": "true" } },
      { attrs: cls("pI_x6G_handle") },
    ],
  };
}

/** dsh 0.2.1-rc.2's Settings panel (ui-settings-general `VOzbGW_`). */
function settings(overrides: { navList?: string; options?: string } = {}): Node {
  return {
    attrs: { ...cls("VOzbGW_panel"), "data-shortcut-modal": "settings" },
    children: [
      {
        tag: "nav",
        attrs: cls("VOzbGW_nav"),
        children: [
          { attrs: cls("VOzbGW_navTitle") },
          {
            attrs: cls(overrides.navList ?? "VOzbGW_navList"),
            children: [
              { attrs: cls("VOzbGW_navCell"), children: [{ attrs: cls("VOzbGW_navLabel") }] },
            ],
          },
        ],
      },
      {
        attrs: cls("VOzbGW_content"),
        children: [
          { attrs: cls("VOzbGW_header") },
          { attrs: cls(overrides.options ?? "VOzbGW_options") },
        ],
      },
    ],
  };
}

test("the phone probes pass on dsh 0.2.1-rc.2's frame, conversation and Settings panel", () => {
  const page = pageOf(frame(), settings());
  assert.equal(probePhoneLayout(page)?.state, "ok");
  assert.equal(probePhoneConversation(page)?.state, "ok");
  assert.equal(probePhoneSettings(page)?.state, "ok");
});

test("a phone probe judges only what is on the page", () => {
  const empty = pageOf({});
  assert.equal(probePhoneLayout(empty), undefined);
  assert.equal(probePhoneConversation(empty), undefined);
  assert.equal(probePhoneSettings(pageOf(frame())), undefined);
});

test("each phone probe catches a renamed part of its own group only", () => {
  const layout = pageOf(frame({ column: "pI_x6G_sidebar" }));
  assert.equal(probePhoneLayout(layout)?.state, "changed");
  assert.equal(probePhoneConversation(layout)?.state, "ok");

  const header = pageOf(frame({ header: "wSkVaW_top" }));
  assert.equal(probePhoneConversation(header)?.state, "changed");
  assert.equal(probePhoneLayout(header)?.state, "ok");
  assert.equal(
    probePhoneConversation(pageOf(frame({ composer: "wSkVaW_seat" })))?.state,
    "changed",
  );

  assert.equal(probePhoneSettings(pageOf(settings({ navList: "VOzbGW_tabs" })))?.state, "changed");
  assert.equal(probePhoneSettings(pageOf(settings({ options: "VOzbGW_body" })))?.state, "changed");
});

test("the phone stylesheet relies on no dsh markup its probes do not check, and drops failed groups", () => {
  const phone = "(max-width: 767px)";
  const all = phoneStylesheet({}, phone);
  const declared = new Set<string>([...Object.values(PARTS), `[${PARTS.collapsed}]`]);
  const used = all.match(/\[class\*="[^"]+"\]|\[data-[\w-]+(?:="[^"]*")?\]/g) ?? [];
  assert.ok(used.length > 0);
  for (const selector of used)
    assert.ok(declared.has(selector), `${selector} is not a declared part`);

  const failed = { state: "changed", reason: "" } as const;
  const withoutSettings = phoneStylesheet({ "phone-settings": failed }, phone);
  assert.ok(!withoutSettings.includes(PARTS.settings));
  assert.ok(withoutSettings.includes(PARTS.sidebarCol));
  const withoutLayout = phoneStylesheet({ "phone-layout": failed }, phone);
  assert.ok(!withoutLayout.includes(PARTS.sidebarCol));
  assert.ok(withoutLayout.includes(PARTS.settings));
  // Rules on plain elements stay whatever dsh looks like.
  assert.ok(withoutLayout.includes("touch-action:manipulation"));
});

test("the Session store passes while dsh writes what Kivotos reads", () => {
  const store = (value: string | null) => ({ getItem: () => value, setItem: () => undefined });
  const shown = pageOf(frame());
  assert.equal(probeSessionStore(store('{"sessionId":"s1"}'), shown)?.state, "ok");
  assert.equal(
    probeSessionStore(store('{"sessionId":"s1","subagentAddress":{"id":"a"}}'), shown)?.state,
    "ok",
  );
  // No Session on screen is nothing to judge.
  assert.equal(probeSessionStore(store(null), pageOf({})), undefined);
  for (const value of [null, '"s1"', '{"session":"s1"}', "not json"]) {
    assert.equal(probeSessionStore(store(value), shown)?.state, "changed", String(value));
  }
});

test("what Kivotos writes as the current Session is what it reads back", () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  assert.equal(currentSession(storage), "");
  selectSession(storage, "s2");
  assert.equal(currentSession(storage), "s2");
  const shown = pageOf({ attrs: { "data-conversation-session": "s2" } });
  assert.equal(probeSessionStore(storage, shown)?.state, "ok");
});

test("a mounted page opened on a Session stores it in its own namespace before dsh boots", () => {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  const replaced: string[] = [];
  const window = { localStorage: storage };
  const context = createContext({
    window,
    location: { hash: "#kivotos-session=s%203", pathname: "/kivotos/peer/b/", search: "" },
    history: {
      state: null,
      replaceState: (_: unknown, __: string, url: string) => replaced.push(url),
    },
  });
  const html = injectStorageNamespace("<head></head>", "b");
  runInContext(/<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "", context);
  // dsh, reading its key through the namespace, finds the Session.
  assert.equal(currentSession((window as { localStorage: typeof storage }).localStorage), "s 3");
  assert.deepEqual([...data.keys()], ["kivotos:b:dsh.sessions.current"]);
  assert.deepEqual(replaced, ["/kivotos/peer/b/"]);
});
