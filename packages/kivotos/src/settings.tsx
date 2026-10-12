/**
 * The Kivotos section of dsh Settings: the machines this one reaches and how,
 * then one tab per way this machine can be reached. The links are
 * independent; a machine can use both at once. The text helpers here word the
 * machine model (machines.ts) for the switcher too.
 */
import QrCode from "qrcode-generator";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { agoOf, statusOf, type MachineInfo, type MachineLink, type Via } from "./machines.ts";

/** Locale lookup bound to the plugin's namespace. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** How often the open section re-reads the links: a relay link changes state by itself. */
const POLL_MS = 3_000;

export const SETTINGS_ZH = {
  "settings.nav": "远程连接",
  "settings.tabs": "连接方式",
  "settings.machines": "机器",
  "settings.tailscale": "Tailscale",
  "settings.relay": "自建中继",
  "settings.loading": "正在读取…",
  "settings.failed": "无法读取连接状态",
  "settings.copy": "复制",
  "settings.copied": "已复制",
  "via.tailscale": "Tailscale",
  "via.relay": "中继",
  "state.online": "在线",
  "state.offline": "离线",
  "state.unreachable": "无法连接",
  "state.denied": "中继拒绝了这个网络",
  "reason.no-listener": "没有 Kivotos 监听",
  "reason.not-kivotos": "端口上不是 Kivotos",
  "reason.forbidden": "拒绝了本设备",
  "reason.timeout": "连接超时",
  "reason.tls": "TLS 错误",
  "reason.network": "连接失败",
  "reason.not-on-tailnet": "本机未连接 Tailscale",
  "reason.relay-connecting": "正在连接中继",
  "reason.relay-unreachable": "无法连接中继",
  "ago.now": "刚刚",
  "ago.minutes": "{count} 分钟前",
  "ago.hours": "{count} 小时前",
  "ago.days": "{count} 天前",
  "status.via": "经由 {via}",
  "status.fallback": "经由 {via} · {down}：{reason}",
  "status.down": "{down}：{reason}",
  "status.offline": "离线",
  "status.offlineSince": "离线 · 最后在线 {ago}",
  "status.unreachable": "无法连接：{reason}",
  "status.lastSeen": "最后在线 {ago}",
  "machines.intro":
    "每台机器只列一次，无论经由哪种方式连接。能直连时走 Tailscale，不通时自动改走中继。",
  "machines.none": "还没有其它机器。用下面的 Tailscale 或自建中继连接它们。",
  "tailscale.intro": "登录同一个 tailnet 账号的手机和电脑可以直接打开这台机器，不需要额外设置。",
  "tailscale.state": "状态",
  "tailscale.joined": "已连接 tailnet，名称 {name}",
  "tailscale.notJoined": "本机未连接 tailnet：请打开 Tailscale 并登录。",
  "tailscale.address": "本机地址",
  "tailscale.unready": "监听尚未就绪：请确认本机已登录 Tailscale。",
  "tailscale.off": "监听已关闭（配置 listen: false）：其它设备无法经 Tailscale 打开本机。",
  "tailscale.pair": "用手机上的 Kivotos 扫描此二维码完成配对，或在侧边栏机器列表里选择“配对手机”。",
  "tailscale.qr": "用于配对手机的二维码",
  "relay.intro":
    "通过你自己部署的中继服务器连接，不依赖 Tailscale。中继只转发加密数据，看不到内容，也无法冒充成员。",
  "relay.address": "中继地址",
  "relay.network": "网络",
  "relay.addressHint": "例如 203.0.113.7:7443 或 https://relay.example.com",
  "relay.create": "创建网络",
  "relay.createHint": "第一台机器在这里创建网络，其余设备用邀请加入。",
  "relay.invite": "邀请链接",
  "relay.inviteHint": "粘贴另一台机器上显示的邀请链接",
  "relay.join": "加入网络",
  "relay.state": "状态",
  "relay.state.connecting": "正在连接…",
  "relay.state.online": "已连接。在线的其它机器：{count}",
  "relay.state.denied": "中继尚未登记这个网络",
  "relay.state.unreachable": "无法连接中继",
  "relay.register": "在中继服务器上执行一次这条命令来登记网络：",
  "relay.share": "邀请其它设备",
  "relay.shareHint":
    "在另一台电脑的这个页面粘贴下面的链接，或用手机上的 Kivotos 扫码。拿到它的人就能加入网络，请像密码一样保管。",
  "relay.qr": "加入网络的二维码",
  "relay.leave": "退出网络",
  "relay.leaveHint": "退出后本机不再经中继可达，并删除本机保存的网络密钥。",
};

export const SETTINGS_EN: Record<keyof typeof SETTINGS_ZH, string> = {
  "settings.nav": "Remote access",
  "settings.tabs": "Ways to connect",
  "settings.machines": "Machines",
  "settings.tailscale": "Tailscale",
  "settings.relay": "Own relay",
  "settings.loading": "Loading…",
  "settings.failed": "Could not read the connection status",
  "settings.copy": "Copy",
  "settings.copied": "Copied",
  "via.tailscale": "Tailscale",
  "via.relay": "Relay",
  "state.online": "Online",
  "state.offline": "Offline",
  "state.unreachable": "Unreachable",
  "state.denied": "Refused by the relay",
  "reason.no-listener": "No Kivotos listener",
  "reason.not-kivotos": "Another service answers",
  "reason.forbidden": "Refused this device",
  "reason.timeout": "Timed out",
  "reason.tls": "TLS error",
  "reason.network": "Connection failed",
  "reason.not-on-tailnet": "This computer is not on the tailnet",
  "reason.relay-connecting": "Connecting to the relay",
  "reason.relay-unreachable": "Relay unreachable",
  "ago.now": "just now",
  "ago.minutes": "{count} min ago",
  "ago.hours": "{count} h ago",
  "ago.days": "{count} d ago",
  "status.via": "Via {via}",
  "status.fallback": "Via {via} · {down}: {reason}",
  "status.down": "{down}: {reason}",
  "status.offline": "Offline",
  "status.offlineSince": "Offline · last seen {ago}",
  "status.unreachable": "Unreachable: {reason}",
  "status.lastSeen": "last seen {ago}",
  "machines.intro":
    "Each machine is listed once, whatever reaches it. Requests go over Tailscale when it works and over the relay when it does not.",
  "machines.none": "No other machines yet. Connect them with Tailscale or your own relay below.",
  "tailscale.intro":
    "Phones and computers signed in to the same tailnet account can open this machine directly. Nothing to set up.",
  "tailscale.state": "Status",
  "tailscale.joined": "On the tailnet as {name}",
  "tailscale.notJoined": "This computer is not on the tailnet: open Tailscale and sign in.",
  "tailscale.address": "This machine's address",
  "tailscale.unready":
    "The listener is not ready: check that this machine is signed in to Tailscale.",
  "tailscale.off":
    "The listener is off (listen: false): other devices cannot open this computer over Tailscale.",
  "tailscale.pair":
    'Scan this code with Kivotos on your phone to pair it, or choose "Pair phone" in the sidebar machine list.',
  "tailscale.qr": "QR code to pair your phone",
  "relay.intro":
    "Connect through a relay server you run, without Tailscale. The relay only forwards encrypted data: it cannot read it or pose as a member.",
  "relay.address": "Relay address",
  "relay.network": "Network",
  "relay.addressHint": "For example 203.0.113.7:7443 or https://relay.example.com",
  "relay.create": "Create network",
  "relay.createHint": "The first machine creates the network here; other devices join by invite.",
  "relay.invite": "Invite link",
  "relay.inviteHint": "Paste the invite link another machine shows",
  "relay.join": "Join network",
  "relay.state": "Status",
  "relay.state.connecting": "Connecting…",
  "relay.state.online": "Connected. Other machines online: {count}",
  "relay.state.denied": "The relay has not registered this network yet",
  "relay.state.unreachable": "Cannot reach the relay",
  "relay.register": "Run this once on the relay server to register the network:",
  "relay.share": "Invite other devices",
  "relay.shareHint":
    "Paste this link on this page of another computer, or scan the code in Kivotos on a phone. Whoever has it can join the network: keep it like a password.",
  "relay.qr": "QR code to join the network",
  "relay.leave": "Leave network",
  "relay.leaveHint":
    "This machine stops being reachable through the relay and forgets the network key.",
};

export const SETTINGS_CSS = `
.kivotos-links{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.kivotos-links-tabs{display:flex;gap:4px;padding:4px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);align-self:flex-start}
.kivotos-links-tab{min-height:32px;padding:4px 14px;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer}
.kivotos-links-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}
.kivotos-links-panel{display:flex;flex-direction:column;gap:16px;min-width:0}
.kivotos-links-text{margin:0;color:var(--dsw-alias-label-secondary)}
.kivotos-links-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.kivotos-links-label{color:var(--dsw-alias-label-primary)}
.kivotos-links-row{display:flex;gap:8px;align-items:flex-start;min-width:0}
.kivotos-links-input{flex:1;min-width:0;height:36px;box-sizing:border-box;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit}
.kivotos-links-button{flex:none;min-height:36px;padding:6px 14px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.kivotos-links-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-links-button:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.kivotos-links-code{flex:1;min-width:0;margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;overflow-wrap:anywhere;user-select:all}
.kivotos-links-error{margin:0;color:var(--dsw-alias-state-error,var(--dsw-alias-label-primary))}
.kivotos-links-qr{display:block;box-sizing:border-box;width:min(100%,220px);height:auto;padding:8px;border-radius:8px;background:#fff}
.kivotos-links-divider{height:0;margin:0;border:0;border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-links-machines{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md)}
.kivotos-links-machine{display:flex;flex-direction:column;gap:4px;padding:12px 14px;min-width:0}
.kivotos-links-machine + .kivotos-links-machine{border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-links-machine-head{display:flex;align-items:baseline;gap:8px;min-width:0}
.kivotos-links-machine-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-weight:500}
.kivotos-links-machine[data-reachable="false"] .kivotos-links-machine-name{color:var(--dsw-alias-label-tertiary)}
.kivotos-links-machine-os{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kivotos-links-machine-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.kivotos-links-machine-links{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2px 12px;margin:2px 0 0;font-size:12px;line-height:18px}
.kivotos-links-machine-links dt{color:var(--dsw-alias-label-tertiary)}
.kivotos-links-machine-links dd{margin:0;min-width:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-secondary)}
.kivotos-links-machine-links dd[data-state="online"]{color:var(--dsw-alias-label-primary)}
`;

/**
 * @param data - text to encode.
 * @returns an SVG path of the dark modules with a 4-module quiet zone, and the code's side.
 */
export function qrOf(data: string): { size: number; path: string } {
  const code = QrCode(0, "M");
  code.addData(data);
  code.make();
  const count = code.getModuleCount();
  const dark: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) dark.push(`M${col + 4} ${row + 4}h1v1h-1z`);
    }
  }
  return { size: count + 8, path: dark.join("") };
}

/** A QR code; black on white whatever the theme, so cameras can read it. */
export function QrImage({
  data,
  label,
  className,
}: {
  data: string;
  label: string;
  className: string;
}): ReactNode {
  const qr = useMemo(() => qrOf(data), [data]);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={qr.size} height={qr.size} fill="#fff" />
      <path d={qr.path} fill="#000" />
    </svg>
  );
}

/** `/kivotos/links` of the machine whose page this is (index.ts registerLinkRoutes). */
interface Links {
  tailscale: {
    /** The tailnet listener's pairing URL, once it listens. */
    url: string | null;
    name: string;
    /** This computer is on the tailnet. */
    joined: boolean;
    address: string | null;
    /** The listener is configured on. */
    listen: boolean;
  };
  relay: {
    joined: boolean;
    relay?: string;
    networkId?: string;
    registration?: string;
    invite?: string;
    state?: "connecting" | "online" | "denied" | "unreachable";
    error?: string | null;
    peers: number;
  };
}

/** `/kivotos/peers`: the serving machine and the machines it knows. */
export interface MachineList {
  self: { name: string; os: string; url?: string; node?: string };
  machines: MachineInfo[];
}

/**
 * Read a `/kivotos/peers` body. A Host from before the machine model sends
 * only `peers`, its mounted machines: each becomes a machine online through
 * its one link.
 */
export function machineListOf(body: unknown): MachineList {
  const value = (typeof body === "object" && body !== null ? body : {}) as {
    self?: MachineList["self"];
    machines?: MachineInfo[];
    peers?: { id: string; name: string; os: string; via?: Via }[];
  };
  const self = value.self ?? { name: "", os: "" };
  if (Array.isArray(value.machines)) return { self, machines: value.machines };
  const machines = (value.peers ?? []).map(({ id, name, os, via = "tailscale" }) => ({
    id,
    name,
    os,
    route: via,
    links: [{ via, state: "online" as const }],
  }));
  return { self, machines };
}

/** @returns how long ago, in words. */
export function agoText(t: Translate, time: number, now: number): string {
  const ago = agoOf(time, now);
  return ago.unit === "now" ? t("ago.now") : t(`ago.${ago.unit}`, { count: ago.count });
}

/** @returns one link's state: why it fails, else its state. */
function linkState(t: Translate, link: MachineLink): string {
  return link.reason === undefined ? t(`state.${link.state}`) : t(`reason.${link.reason}`);
}

/** @returns one link's line: its state with any reason, address, and when it last worked if it does not now. */
export function linkText(t: Translate, link: MachineLink, now: number): string {
  const parts = [
    link.state === "unreachable" && link.reason !== undefined
      ? t("status.unreachable", { reason: t(`reason.${link.reason}`) })
      : t(`state.${link.state}`),
  ];
  if (link.address !== undefined) parts.push(link.address);
  if (link.state !== "online" && link.lastSeen !== undefined)
    parts.push(t("status.lastSeen", { ago: agoText(t, link.lastSeen, now) }));
  return parts.join(" · ");
}

/**
 * @param brief - next to a route tag (the switcher): leave the route out of a fallback.
 * @returns a machine's one-line status: its route, and why a preferred link is not used.
 */
export function statusText(
  t: Translate,
  machine: Pick<MachineInfo, "links">,
  now: number,
  brief = false,
): string {
  const status = statusOf(machine);
  switch (status.kind) {
    case "online": {
      const via = t(`via.${status.via}`);
      if (status.down === undefined) return t("status.via", { via });
      const down = t(`via.${status.down.via}`);
      const reason = linkState(t, status.down);
      return brief
        ? t("status.down", { down, reason })
        : t("status.fallback", { via, down, reason });
    }
    case "offline":
      return status.lastSeen === undefined
        ? t("status.offline")
        : t("status.offlineSince", { ago: agoText(t, status.lastSeen, now) });
    case "unreachable":
      return t("status.unreachable", { reason: linkState(t, status.link) });
    case "denied":
      return t("state.denied");
  }
}

/**
 * Document-relative, unlike the machine list: on a peer's page these settings
 * are the peer's, reached through the same mount as the rest of its UI.
 */
function linksUrl(name: string): string {
  return new URL(`kivotos/${name}`, document.baseURI).toString();
}

async function readBody(response: Response): Promise<Links> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message: unknown =
      typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
    throw new Error(typeof message === "string" ? message : String(response.status));
  }
  // The route is Kivotos' own (same version as this module), behind dsh's fence.
  return body as Links;
}

interface LinksState {
  links: Links | null;
  /** The machines this page's machine knows; null until read. */
  machines: MachineInfo[] | null;
  failed: boolean;
  /** Message of the last relay action that was refused. */
  error: string | null;
  busy: boolean;
  act: (body: Record<string, string>) => void;
}

function useLinks(): LinksState {
  const [links, setLinks] = useState<Links | null>(null);
  const [machines, setMachines] = useState<MachineInfo[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = async (): Promise<void> => {
      try {
        const [linksResponse, peersResponse] = await Promise.all([
          fetch(linksUrl("links"), { headers: { accept: "application/json" } }),
          fetch(linksUrl("peers"), { headers: { accept: "application/json" } }),
        ]);
        const next = await readBody(linksResponse);
        const list = peersResponse.ok ? machineListOf(await peersResponse.json()) : null;
        if (stopped) return;
        setLinks(next);
        setMachines(list?.machines ?? null);
        setFailed(false);
      } catch {
        if (!stopped) setFailed(true);
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  const act = useCallback((body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(linksUrl("relay"), {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        setLinks(await readBody(response));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  return { links, machines, failed, error, busy, act };
}

/** Text people copy out; the button appears only where the clipboard API exists. */
function Copyable({ text, t }: { text: string; t: Translate }): ReactNode {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void (async () => {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    })();
  }, [text]);
  useEffect(() => setCopied(false), [text]);
  // Pages served over plain HTTP on a tailnet address have no clipboard API;
  // the text itself selects whole on a click.
  const canCopy = typeof navigator.clipboard?.writeText === "function";
  return (
    <div className="kivotos-links-row">
      <code className="kivotos-links-code">{text}</code>
      {canCopy ? (
        <button type="button" className="kivotos-links-button" onClick={copy}>
          {copied ? t("settings.copied") : t("settings.copy")}
        </button>
      ) : null}
    </div>
  );
}

function TailscalePanel({ links, t }: { links: Links; t: Translate }): ReactNode {
  const { url, joined, name, address, listen } = links.tailscale;
  const pairing = useMemo(
    () => (url === null ? null : `kivotos://pair?url=${encodeURIComponent(url)}`),
    [url],
  );
  let listener: ReactNode;
  if (!listen) listener = <p className="kivotos-links-text">{t("tailscale.off")}</p>;
  else if (url === null || pairing === null)
    listener = <p className="kivotos-links-text">{t("tailscale.unready")}</p>;
  else {
    listener = (
      <div className="kivotos-links-field">
        <span className="kivotos-links-label">{t("tailscale.address")}</span>
        <Copyable text={url} t={t} />
        <p className="kivotos-links-text">{t("tailscale.pair")}</p>
        <QrImage data={pairing} label={t("tailscale.qr")} className="kivotos-links-qr" />
      </div>
    );
  }
  const where = address === null ? name : `${name} (${address})`;
  return (
    <div className="kivotos-links-panel" role="tabpanel">
      <p className="kivotos-links-text">{t("tailscale.intro")}</p>
      <div className="kivotos-links-field">
        <span className="kivotos-links-label">{t("tailscale.state")}</span>
        <p className="kivotos-links-text" role="status">
          {joined ? t("tailscale.joined", { name: where }) : t("tailscale.notJoined")}
        </p>
      </div>
      {listener}
    </div>
  );
}

/** One machine: its status line, then each link's state. */
function MachineCard({
  machine,
  now,
  t,
}: {
  machine: MachineInfo;
  now: number;
  t: Translate;
}): ReactNode {
  return (
    <li className="kivotos-links-machine" data-reachable={String(machine.route !== null)}>
      <div className="kivotos-links-machine-head">
        <span className="kivotos-links-machine-name">{machine.name}</span>
        {machine.os === "" ? null : <span className="kivotos-links-machine-os">{machine.os}</span>}
      </div>
      <p className="kivotos-links-machine-status">{statusText(t, machine, now)}</p>
      <dl className="kivotos-links-machine-links">
        {machine.links.map((link) => (
          <React.Fragment key={link.via}>
            <dt>{t(`via.${link.via}`)}</dt>
            <dd data-state={link.state}>{linkText(t, link, now)}</dd>
          </React.Fragment>
        ))}
      </dl>
    </li>
  );
}

function MachinesPanel({
  machines,
  t,
}: {
  machines: MachineInfo[] | null;
  t: Translate;
}): ReactNode {
  // Re-rendered on every poll, which also moves "last seen" along.
  const now = Date.now();
  let list: ReactNode;
  if (machines === null) list = <p className="kivotos-links-text">{t("settings.loading")}</p>;
  else if (machines.length === 0) list = <p className="kivotos-links-text">{t("machines.none")}</p>;
  else {
    list = (
      <ul className="kivotos-links-machines">
        {machines.map((machine) => (
          <MachineCard key={machine.id} machine={machine} now={now} t={t} />
        ))}
      </ul>
    );
  }
  return (
    <div className="kivotos-links-panel" role="tabpanel">
      <p className="kivotos-links-text">{t("machines.intro")}</p>
      {list}
    </div>
  );
}

function RelayForm({ state, t }: { state: LinksState; t: Translate }): ReactNode {
  const [address, setAddress] = useState("");
  const [invite, setInvite] = useState("");
  const { act, busy } = state;
  const onAddress = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setAddress(event.target.value),
    [],
  );
  const onInvite = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setInvite(event.target.value),
    [],
  );
  const create = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      act({ action: "create", relay: address });
    },
    [act, address],
  );
  const join = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      act({ action: "join", invite });
    },
    [act, invite],
  );
  return (
    <>
      <form className="kivotos-links-field" onSubmit={join}>
        <label className="kivotos-links-label" htmlFor="kivotos-relay-invite">
          {t("relay.invite")}
        </label>
        <div className="kivotos-links-row">
          <input
            id="kivotos-relay-invite"
            className="kivotos-links-input"
            value={invite}
            onChange={onInvite}
            placeholder={t("relay.inviteHint")}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="kivotos-links-button"
            disabled={busy || invite.trim() === ""}
          >
            {t("relay.join")}
          </button>
        </div>
      </form>
      <hr className="kivotos-links-divider" />
      <form className="kivotos-links-field" onSubmit={create}>
        <label className="kivotos-links-label" htmlFor="kivotos-relay-address">
          {t("relay.address")}
        </label>
        <div className="kivotos-links-row">
          <input
            id="kivotos-relay-address"
            className="kivotos-links-input"
            value={address}
            onChange={onAddress}
            placeholder={t("relay.addressHint")}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="kivotos-links-button"
            disabled={busy || address.trim() === ""}
          >
            {t("relay.create")}
          </button>
        </div>
        <p className="kivotos-links-text">{t("relay.createHint")}</p>
      </form>
    </>
  );
}

function RelayMembership({ state, t }: { state: LinksState; t: Translate }): ReactNode {
  const { act, busy } = state;
  const relay = state.links?.relay;
  const leave = useCallback(() => act({ action: "leave" }), [act]);
  if (relay === undefined) return null;
  const status = relay.state ?? "connecting";
  return (
    <>
      <div className="kivotos-links-field">
        <span className="kivotos-links-label">{t("relay.address")}</span>
        <code className="kivotos-links-code">{relay.relay}</code>
      </div>
      {relay.networkId === undefined ? null : (
        <div className="kivotos-links-field">
          <span className="kivotos-links-label">{t("relay.network")}</span>
          <code className="kivotos-links-code">{relay.networkId}</code>
        </div>
      )}
      <div className="kivotos-links-field">
        <span className="kivotos-links-label">{t("relay.state")}</span>
        <p className="kivotos-links-text" role="status">
          {t(`relay.state.${status}`, { count: relay.peers })}
        </p>
        {status === "denied" && relay.registration !== undefined ? (
          <>
            <p className="kivotos-links-text">{t("relay.register")}</p>
            <Copyable text={`kivotos-relay network add ${relay.registration}`} t={t} />
          </>
        ) : null}
      </div>
      {relay.invite === undefined ? null : (
        <div className="kivotos-links-field">
          <span className="kivotos-links-label">{t("relay.share")}</span>
          <p className="kivotos-links-text">{t("relay.shareHint")}</p>
          <Copyable text={relay.invite} t={t} />
          <QrImage data={relay.invite} label={t("relay.qr")} className="kivotos-links-qr" />
        </div>
      )}
      <hr className="kivotos-links-divider" />
      <div className="kivotos-links-field">
        <p className="kivotos-links-text">{t("relay.leaveHint")}</p>
        <div className="kivotos-links-row">
          <button type="button" className="kivotos-links-button" disabled={busy} onClick={leave}>
            {t("relay.leave")}
          </button>
        </div>
      </div>
    </>
  );
}

type Tab = "machines" | "tailscale" | "relay";
const TABS: readonly Tab[] = ["machines", "tailscale", "relay"];

/** The section body: the machines, then a tab per link. */
export function LinksSection({ t }: { t: Translate }): ReactNode {
  const [tab, setTab] = useState<Tab>("machines");
  const state = useLinks();
  const select = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const next = TABS.find((id) => id === event.currentTarget.value);
    if (next !== undefined) setTab(next);
  }, []);
  const { links } = state;
  let body: ReactNode;
  if (links === null) {
    body = (
      <p className="kivotos-links-text">
        {t(state.failed ? "settings.failed" : "settings.loading")}
      </p>
    );
  } else if (tab === "machines") {
    body = <MachinesPanel machines={state.machines} t={t} />;
  } else if (tab === "tailscale") {
    body = <TailscalePanel links={links} t={t} />;
  } else {
    body = (
      <div className="kivotos-links-panel" role="tabpanel">
        <p className="kivotos-links-text">{t("relay.intro")}</p>
        {links.relay.joined ? (
          <RelayMembership state={state} t={t} />
        ) : (
          <RelayForm state={state} t={t} />
        )}
        {state.error === null ? null : (
          <p className="kivotos-links-error" role="alert">
            {state.error}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="kivotos-links">
      <div className="kivotos-links-tabs" role="tablist" aria-label={t("settings.tabs")}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            value={id}
            className="kivotos-links-tab"
            aria-selected={tab === id}
            onClick={select}
          >
            {t(`settings.${id}`)}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}
