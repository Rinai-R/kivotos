/**
 * The Kivotos section of dsh Settings, one page: this machine's links (a
 * line each, with what managing it needs folded under it), then the machines
 * it knows, each with its state on every link this machine has and, for a
 * machine reached both ways, its connection mode. The links are independent;
 * a machine can use both at once. The text helpers here word the machine
 * model (machines.ts) for the switcher too.
 */
import QrCode from "qrcode-generator";
import * as React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  agoOf,
  isRouteMode,
  modeOptions,
  pinnedVia,
  statusOf,
  type MachineInfo,
  type MachineLink,
  type ModeOption,
  type RouteMode,
  type Via,
} from "./machines.ts";

/** Locale lookup bound to the plugin's namespace. */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/** How often the open section re-reads the links: a relay link changes state by itself. */
const POLL_MS = 3_000;

export const SETTINGS_ZH = {
  "settings.nav": "远程连接",
  "settings.links": "连接方式",
  "settings.machines": "机器",
  "settings.tailscale": "Tailscale",
  "settings.relay": "自建中继",
  "settings.loading": "正在读取…",
  "settings.failed": "无法读取连接状态",
  "settings.copy": "复制",
  "settings.copied": "已复制",
  "settings.manage": "管理",
  "settings.setUp": "配置",
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
  "status.viaOnly": "仅经由 {via}",
  "status.only": "仅 {via} · {status}",
  "status.fallback": "经由 {via} · {down}：{reason}",
  "status.down": "{down}：{reason}",
  "status.offline": "离线",
  "status.offlineSince": "离线 · 最后在线 {ago}",
  "status.unreachable": "无法连接：{reason}",
  "status.lastSeen": "最后在线 {ago}",
  "chip.noTailnet": "不在 tailnet 中",
  "chip.noNetwork": "不在网络中",
  "mode.auto": "自动",
  "mode.label": "{name} 的连接方式",
  "mode.unavailable": "不可用：{reason}",
  "mode.setOn": "{name} 上的设置",
  "mode.failed": "无法更改连接方式",
  "machines.intro":
    "每台机器只列一次，无论经由哪种方式连接。自动：能直连时走 Tailscale，不通时改走中继。选 Tailscale 或中继则只用那一种，不通时不会改道。",
  "machines.none": "还没有其它机器。用上面的 Tailscale 或自建中继连接它们。",
  "tailscale.joined": "已连接 tailnet，名称 {name}",
  "tailscale.notJoined": "本机未连接 tailnet：请打开 Tailscale 并登录。",
  "tailscale.unready": "监听尚未就绪：请确认本机已登录 Tailscale。",
  "tailscale.off": "监听已关闭（配置 listen: false）：其它设备无法经 Tailscale 打开本机。",
  "relay.intro":
    "通过你自己部署的中继服务器连接，不依赖 Tailscale。中继只转发加密数据，看不到内容，也无法冒充成员。",
  "relay.none": "未加入网络",
  "relay.address": "中继地址",
  "relay.network": "网络",
  "relay.addressHint": "例如 203.0.113.7:7443 或 https://relay.example.com",
  "relay.create": "创建网络",
  "relay.createHint": "第一台机器在这里创建网络，其余设备用邀请加入。",
  "relay.invite": "邀请链接",
  "relay.inviteHint": "粘贴另一台机器上显示的邀请链接",
  "relay.join": "加入网络",
  "relay.state.connecting": "正在连接…",
  "relay.state.online": "在线",
  "relay.state.denied": "中继尚未登记这个网络",
  "relay.state.unreachable": "无法连接中继",
  "relay.peers": "在线机器：{count}",
  "relay.register": "在中继服务器上执行一次这条命令来登记网络：",
  "relay.share": "邀请其它设备",
  "relay.shareHint":
    "在另一台电脑的 设置 → 远程连接 → 自建中继 → 配置 中粘贴下面的链接，或用手机上的 Kivotos 扫码。拿到它的人就能加入网络，请像密码一样保管。",
  "relay.qr": "加入网络的二维码",
  "relay.leave": "退出网络",
  "relay.leaveHint": "退出后本机不再经中继可达，并删除本机保存的网络密钥。",
  "pair.action": "配对手机",
  "pair.unavailable": "此机器的远程连接尚未就绪",
  "pair.title": "配对手机",
  "pair.instructions": "用手机上的 Kivotos 扫描此二维码，或手动输入下方地址。",
  "pair.qr": "用于配对手机的二维码",
  "pair.address": "配对地址",
  "pair.close": "关闭",
};

export const SETTINGS_EN: Record<keyof typeof SETTINGS_ZH, string> = {
  "settings.nav": "Remote access",
  "settings.links": "Links",
  "settings.machines": "Machines",
  "settings.tailscale": "Tailscale",
  "settings.relay": "Own relay",
  "settings.loading": "Loading…",
  "settings.failed": "Could not read the connection status",
  "settings.copy": "Copy",
  "settings.copied": "Copied",
  "settings.manage": "Manage",
  "settings.setUp": "Set up",
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
  "status.viaOnly": "Via {via} only",
  "status.only": "{via} only · {status}",
  "status.fallback": "Via {via} · {down}: {reason}",
  "status.down": "{down}: {reason}",
  "status.offline": "Offline",
  "status.offlineSince": "Offline · last seen {ago}",
  "status.unreachable": "Unreachable: {reason}",
  "status.lastSeen": "last seen {ago}",
  "chip.noTailnet": "Not on tailnet",
  "chip.noNetwork": "Not in network",
  "mode.auto": "Auto",
  "mode.label": "How to reach {name}",
  "mode.unavailable": "Unavailable: {reason}",
  "mode.setOn": "Set on {name}",
  "mode.failed": "Could not change how the machine is reached",
  "machines.intro":
    "Each machine is listed once, whatever reaches it. Auto goes over Tailscale when it works and over the relay when it does not; Tailscale or Relay uses only that link and is never rerouted.",
  "machines.none": "No other machines yet. Connect them with Tailscale or your own relay above.",
  "tailscale.joined": "On the tailnet as {name}",
  "tailscale.notJoined": "This computer is not on the tailnet: open Tailscale and sign in.",
  "tailscale.unready":
    "The listener is not ready: check that this machine is signed in to Tailscale.",
  "tailscale.off":
    "The listener is off (listen: false): other devices cannot open this computer over Tailscale.",
  "relay.intro":
    "Connect through a relay server you run, without Tailscale. The relay only forwards encrypted data: it cannot read it or pose as a member.",
  "relay.none": "Not in a network",
  "relay.address": "Relay address",
  "relay.network": "Network",
  "relay.addressHint": "For example 203.0.113.7:7443 or https://relay.example.com",
  "relay.create": "Create network",
  "relay.createHint": "The first machine creates the network here; other devices join by invite.",
  "relay.invite": "Invite link",
  "relay.inviteHint": "Paste the invite link another machine shows",
  "relay.join": "Join network",
  "relay.state.connecting": "Connecting…",
  "relay.state.online": "Online",
  "relay.state.denied": "Not registered on the relay",
  "relay.state.unreachable": "Relay unreachable",
  "relay.peers": "Machines online: {count}",
  "relay.register": "Run this once on the relay server to register the network:",
  "relay.share": "Invite other devices",
  "relay.shareHint":
    "Paste this link on another computer under Settings → Remote access → Own relay → Set up, or scan the code in Kivotos on a phone. Whoever has it can join the network: keep it like a password.",
  "relay.qr": "QR code to join the network",
  "relay.leave": "Leave network",
  "relay.leaveHint":
    "This machine stops being reachable through the relay and forgets the network key.",
  "pair.action": "Pair phone",
  "pair.unavailable": "This machine's remote listener is not ready",
  "pair.title": "Pair phone",
  "pair.instructions":
    "Scan this code in Kivotos on your phone, or enter the address below manually.",
  "pair.qr": "QR code to pair your phone",
  "pair.address": "Pairing address",
  "pair.close": "Close",
};

export const SETTINGS_CSS = `
.kivotos-links{container-type:inline-size;display:flex;flex-direction:column;gap:24px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.kivotos-links-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.kivotos-links-heading{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.kivotos-links-text{margin:0;color:var(--dsw-alias-label-secondary)}
.kivotos-links-list{display:flex;flex-direction:column;margin:0;padding:0;list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md)}
.kivotos-links-list > li + li{border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-links-line{display:flex;flex-direction:column;padding:10px 14px;min-width:0}
.kivotos-links-line-head{display:flex;align-items:center;gap:10px;min-width:0;min-height:32px}
.kivotos-links-dot{flex:none;align-self:flex-start;width:8px;height:8px;margin-top:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.kivotos-links-dot[data-tone="ok"]{background:var(--dsw-alias-state-success-primary)}
.kivotos-links-dot[data-tone="busy"]{background:var(--dsw-alias-state-warn-primary)}
.kivotos-links-dot[data-tone="bad"]{background:var(--dsw-alias-state-error-primary)}
.kivotos-links-line-body{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.kivotos-links-line-name{margin-right:8px;color:var(--dsw-alias-label-primary);font-weight:500}
.kivotos-links-line-meta{color:var(--dsw-alias-label-tertiary)}
.kivotos-links-line-action{flex:none;display:inline-flex;align-items:center;gap:4px;min-height:30px;padding:4px 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.kivotos-links-line-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-links-line-action svg{transition:transform 120ms}
.kivotos-links-line-action[aria-expanded="true"] svg{transform:rotate(180deg)}
.kivotos-links-details{display:flex;flex-direction:column;gap:16px;margin-top:10px;padding:14px 0 4px;border-top:0.5px solid var(--dsw-alias-border-l2);min-width:0}
.kivotos-links-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.kivotos-links-label{color:var(--dsw-alias-label-primary)}
.kivotos-links-row{display:flex;gap:8px;align-items:flex-start;min-width:0}
.kivotos-links-input{flex:1;min-width:0;height:36px;box-sizing:border-box;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit}
.kivotos-links-button{flex:none;min-height:36px;padding:6px 14px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.kivotos-links-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-links-button:disabled{color:var(--dsw-alias-label-tertiary);cursor:not-allowed}
.kivotos-links-code{flex:1;min-width:0;margin:0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;overflow-wrap:anywhere;user-select:all}
.kivotos-links-error{margin:0;color:var(--dsw-alias-state-error-primary)}
.kivotos-links-qr{display:block;box-sizing:border-box;width:min(100%,200px);height:auto;padding:8px;border-radius:8px;background:#fff}
.kivotos-links-divider{height:0;margin:0;border:0;border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-links-machine{display:flex;flex-direction:column;gap:2px;padding:12px 14px;min-width:0}
.kivotos-links-machine-head{display:flex;align-items:baseline;gap:8px;min-width:0}
.kivotos-links-machine-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500}
.kivotos-links-machine[data-reachable="false"] .kivotos-links-machine-name{color:var(--dsw-alias-label-tertiary)}
.kivotos-links-machine-os{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.kivotos-links-machine-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.kivotos-links-machine-foot{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin-top:6px;min-width:0}
.kivotos-links-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none;min-width:0}
.kivotos-links-chip{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-height:24px;padding:2px 10px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:999px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.kivotos-links-chip::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.kivotos-links-chip[data-state="online"]::before{background:var(--dsw-alias-state-success-primary)}
.kivotos-links-chip[data-state="unreachable"]::before,.kivotos-links-chip[data-state="denied"]::before{background:var(--dsw-alias-state-error-primary)}
.kivotos-links-chip[data-state="missing"]{border-style:dashed;color:var(--dsw-alias-label-tertiary)}
.kivotos-links-chip[data-state="missing"]::before{display:none}
.kivotos-mode{display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-left:auto;min-width:0}
.kivotos-mode-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:6px 10px;min-width:0}
.kivotos-mode-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.kivotos-mode-seg{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-mode-option{position:relative;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-height:28px;padding:3px 12px;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;cursor:pointer}
.kivotos-mode-option:hover{color:var(--dsw-alias-label-primary)}
.kivotos-mode-option input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.kivotos-mode-option[data-checked]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv1)}
.kivotos-mode-option[data-unavailable]::after{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-error-primary)}
.kivotos-mode-option:has(input:focus-visible){outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kivotos-mode-note{contain:inline-size;align-self:stretch;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:16px;text-align:right}
@container (max-width:520px){.kivotos-mode{align-items:flex-start;margin-left:0}.kivotos-mode-row{justify-content:flex-start}.kivotos-mode-note{text-align:left}}
.kivotos-pair{box-sizing:border-box;width:min(92vw,380px);max-height:90dvh;overflow:auto;margin:auto;padding:24px;border:1px solid var(--dsw-alias-interactive-bg-hover);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font:inherit}
.kivotos-pair::backdrop{background:var(--dsw-alias-bg-mask-1)}
.kivotos-pair-title{margin:0 0 12px;font-size:18px}
.kivotos-pair-instructions{margin:0 0 18px;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:1.5}
.kivotos-pair-qr{display:block;box-sizing:border-box;width:min(100%,260px);height:auto;margin:0 auto 18px;padding:10px;border-radius:8px;background:#fff}
.kivotos-pair-address{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.kivotos-pair-url{display:block;margin-top:6px;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary);font-size:14px;user-select:all}
.kivotos-pair-close{display:block;margin:24px 0 0 auto;min-height:40px;padding:6px 16px;border:0;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.kivotos-pair-close:hover{filter:brightness(1.1)}
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
 * its one link. A Host from before modes reaches every machine in auto.
 */
export function machineListOf(body: unknown): MachineList {
  const value = (typeof body === "object" && body !== null ? body : {}) as {
    self?: MachineList["self"];
    machines?: (Omit<MachineInfo, "mode"> & { mode?: unknown })[];
    peers?: { id: string; name: string; os: string; via?: Via }[];
  };
  const self = value.self ?? { name: "", os: "" };
  if (Array.isArray(value.machines)) {
    for (const machine of value.machines) if (!isRouteMode(machine.mode)) machine.mode = "auto";
    return { self, machines: value.machines as MachineInfo[] };
  }
  const machines = (value.peers ?? []).map(({ id, name, os, via = "tailscale" }) => ({
    id,
    name,
    os,
    mode: "auto" as const,
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

/** @returns one link in full (a chip's tooltip): its state with any reason, address, and when it last worked if it does not now. */
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
 * @returns a machine's one-line status: its route by its mode, why a
 *   preferred link is not used, and the one link a mode holds it to.
 */
export function statusText(
  t: Translate,
  machine: Pick<MachineInfo, "links" | "mode">,
  now: number,
  brief = false,
): string {
  const pinned = pinnedVia(machine, machine.mode);
  const status = statusOf(machine, machine.mode);
  let text: string;
  switch (status.kind) {
    case "online": {
      const via = t(`via.${status.via}`);
      if (pinned !== null) return t("status.viaOnly", { via });
      if (status.down === undefined) return t("status.via", { via });
      const down = t(`via.${status.down.via}`);
      const reason = linkState(t, status.down);
      return brief
        ? t("status.down", { down, reason })
        : t("status.fallback", { via, down, reason });
    }
    case "offline":
      text =
        status.lastSeen === undefined
          ? t("status.offline")
          : t("status.offlineSince", { ago: agoText(t, status.lastSeen, now) });
      break;
    case "unreachable":
      text = t("status.unreachable", { reason: linkState(t, status.link) });
      break;
    case "denied":
      text = t("state.denied");
      break;
  }
  return pinned === null ? text : t("status.only", { via: t(`via.${pinned}`), status: text });
}

/**
 * Document-relative, unlike the machine list: on a peer's page these settings
 * are the peer's, reached through the same mount as the rest of its UI.
 */
function linksUrl(name: string): string {
  return new URL(`kivotos/${name}`, document.baseURI).toString();
}

async function readBody<T>(response: Response): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message: unknown =
      typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
    throw new Error(typeof message === "string" ? message : String(response.status));
  }
  // The routes are Kivotos' own (same version as this module), behind dsh's fence.
  return body as T;
}

/** `host:port` of a listener or relay URL, as the page shows it. */
function hostOf(address: string): string {
  return address.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
}

/**
 * A machine's line: its route alone when it has one (the chips say why
 * another link is not used), else its status.
 */
function routeText(t: Translate, machine: MachineInfo, now: number): string {
  const status = statusOf(machine, machine.mode);
  if (status.kind !== "online") return statusText(t, machine, now);
  const via = t(`via.${status.via}`);
  return pinnedVia(machine, machine.mode) === null
    ? t("status.via", { via })
    : t("status.viaOnly", { via });
}

function ChevronGlyph(): ReactNode {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M3 4.5 6 7.5 9 4.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The pairing code. A native modal keeps keyboard focus and Escape inside
 * the dialog, in the phone drawer and in the Settings panel alike.
 */
export function PairDialog({
  url,
  t,
  onClose,
}: {
  url: string;
  t: Translate;
  onClose: () => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const dismiss = useCallback(() => dialog.current?.close(), []);
  // Escape closes this dialog only, not the Settings panel it was opened from.
  const onKey = useCallback((event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") event.stopPropagation();
  }, []);
  const data = useMemo(() => `kivotos://pair?url=${encodeURIComponent(url)}`, [url]);

  return (
    <dialog
      ref={dialog}
      className="kivotos-pair"
      aria-labelledby="kivotos-pair-title"
      aria-describedby="kivotos-pair-instructions"
      onClose={onClose}
      onKeyDown={onKey}
    >
      <h2 id="kivotos-pair-title" className="kivotos-pair-title">
        {t("pair.title")}
      </h2>
      <p id="kivotos-pair-instructions" className="kivotos-pair-instructions">
        {t("pair.instructions")}
      </p>
      <QrImage data={data} label={t("pair.qr")} className="kivotos-pair-qr" />
      <p className="kivotos-pair-address">
        {t("pair.address")}
        <code className="kivotos-pair-url">{url}</code>
      </p>
      <button type="button" className="kivotos-pair-close" autoFocus onClick={dismiss}>
        {t("pair.close")}
      </button>
    </dialog>
  );
}

interface LinksState {
  links: Links | null;
  /** The machines this page's machine knows; null until read. */
  list: MachineList | null;
  failed: boolean;
  /** Message of the last relay action that was refused. */
  error: string | null;
  /** The last mode change failed. */
  modeError: string | null;
  busy: boolean;
  act: (body: Record<string, string>) => void;
  /** Set how this page's machine reaches one machine (index.ts `/kivotos/mode`). */
  changeMode: (id: string, mode: RouteMode) => void;
}

function useLinks(t: Translate): LinksState {
  const [links, setLinks] = useState<Links | null>(null);
  const [list, setList] = useState<MachineList | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stopped = false;
    const load = async (): Promise<void> => {
      try {
        const [linksResponse, peersResponse] = await Promise.all([
          fetch(linksUrl("links"), { headers: { accept: "application/json" } }),
          fetch(linksUrl("peers"), { headers: { accept: "application/json" } }),
        ]);
        const next = await readBody<Links>(linksResponse);
        const machines = peersResponse.ok ? machineListOf(await peersResponse.json()) : null;
        if (stopped) return;
        setLinks(next);
        setList(machines);
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
        setLinks(await readBody<Links>(response));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const changeMode = useCallback(
    (machine: string, mode: RouteMode) => {
      setModeError(null);
      void (async () => {
        try {
          const response = await fetch(linksUrl("mode"), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ machine, mode }),
          });
          setList(machineListOf(await readBody<unknown>(response)));
        } catch {
          setModeError(t("mode.failed"));
        }
      })();
    },
    [t],
  );

  return { links, list, failed, error, modeError, busy, act, changeMode };
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

/** A link line's dot: working, on its way, failing, or not set up. */
type Tone = "ok" | "busy" | "bad" | "off";

/** The head of a link line: dot, name, state and details, then its action (`children`). */
function LinkHead({
  name,
  tone,
  text,
  meta,
  children,
}: {
  name: string;
  tone: Tone;
  text: string;
  meta: string | null;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="kivotos-links-line-head">
      <span className="kivotos-links-dot" data-tone={tone} aria-hidden />
      <span className="kivotos-links-line-body">
        <span className="kivotos-links-line-name">{name}</span>
        <span role="status">
          {text}
          {meta === null ? null : <span className="kivotos-links-line-meta">{` · ${meta}`}</span>}
        </span>
      </span>
      {children}
    </div>
  );
}

/**
 * Tailscale: whether this computer is on the tailnet, its listener address,
 * and its pairing code (not inside the phone app, which is what gets paired).
 */
function TailscaleLine({
  links,
  inApp,
  t,
}: {
  links: Links;
  inApp: boolean;
  t: Translate;
}): ReactNode {
  const [pairing, setPairing] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const pair = useCallback(() => setPairing(true), []);
  const closePair = useCallback(() => {
    setPairing(false);
    button.current?.focus();
  }, []);
  const { url, joined, name, address, listen } = links.tailscale;
  let tone: Tone = "ok";
  let text = t("tailscale.joined", { name });
  if (!joined) {
    tone = "bad";
    text = t("tailscale.notJoined");
  } else if (!listen) {
    tone = "busy";
    text = t("tailscale.off");
  } else if (url === null) {
    tone = "busy";
    text = t("tailscale.unready");
  }
  let meta: string | null = null;
  if (url !== null) meta = hostOf(url);
  else if (joined) meta = address;
  return (
    <li className="kivotos-links-line">
      <LinkHead name={t("settings.tailscale")} tone={tone} text={text} meta={meta}>
        {url === null || inApp ? null : (
          <button ref={button} type="button" className="kivotos-links-line-action" onClick={pair}>
            {t("pair.action")}
          </button>
        )}
      </LinkHead>
      {pairing && url !== null ? <PairDialog url={url} t={t} onClose={closePair} /> : null}
    </li>
  );
}

/** In a network: its id, the invite to share, the registration while refused, and Leave. */
function RelayManage({ relay, act, busy, t }: RelayActions & { relay: Links["relay"] }): ReactNode {
  const leave = useCallback(() => act({ action: "leave" }), [act]);
  return (
    <>
      {relay.networkId === undefined ? null : (
        <div className="kivotos-links-field">
          <span className="kivotos-links-label">{t("relay.network")}</span>
          <code className="kivotos-links-code">{relay.networkId}</code>
        </div>
      )}
      {relay.state === "denied" && relay.registration !== undefined ? (
        <div className="kivotos-links-field">
          <p className="kivotos-links-text">{t("relay.register")}</p>
          <Copyable text={`kivotos-relay network add ${relay.registration}`} t={t} />
        </div>
      ) : null}
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

/** Own relay: the network's state, relay and machines online; Manage or Set up folds out below. */
function RelayLine({
  state,
  relay,
  t,
}: {
  state: LinksState;
  relay: Links["relay"];
  t: Translate;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  const { act, busy } = state;
  let tone: Tone = "off";
  let text = t("relay.none");
  const meta: string[] = [];
  if (relay.joined) {
    const status = relay.state ?? "connecting";
    tone = "bad";
    if (status === "online") tone = "ok";
    else if (status === "connecting") tone = "busy";
    text = t(`relay.state.${status}`);
    if (relay.relay !== undefined) meta.push(hostOf(relay.relay));
    if (status === "online") meta.push(t("relay.peers", { count: relay.peers }));
  }
  return (
    <li className="kivotos-links-line">
      <LinkHead
        name={t("settings.relay")}
        tone={tone}
        text={text}
        meta={meta.length === 0 ? null : meta.join(" · ")}
      >
        <button
          type="button"
          className="kivotos-links-line-action"
          aria-expanded={open}
          aria-controls={open ? detailsId : undefined}
          onClick={toggle}
        >
          {t(relay.joined ? "settings.manage" : "settings.setUp")}
          <ChevronGlyph />
        </button>
      </LinkHead>
      {open ? (
        <div id={detailsId} className="kivotos-links-details">
          {relay.joined ? (
            <RelayManage relay={relay} act={act} busy={busy} t={t} />
          ) : (
            <RelayForm act={act} busy={busy} t={t} />
          )}
          {state.error === null ? null : (
            <p className="kivotos-links-error" role="alert">
              {state.error}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}

interface RelayActions {
  act: LinksState["act"];
  busy: boolean;
  t: Translate;
}

/** Not in a network: join one by invite, or create it on a relay. */
function RelayForm({ act, busy, t }: RelayActions): ReactNode {
  const [address, setAddress] = useState("");
  const [invite, setInvite] = useState("");
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
      <p className="kivotos-links-text">{t("relay.intro")}</p>
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

/** A machine's state on one link this computer has; dashed when the machine lacks that link. */
function LinkChip({
  via,
  link,
  now,
  t,
}: {
  via: Via;
  link: MachineLink | undefined;
  now: number;
  t: Translate;
}): ReactNode {
  if (link === undefined) {
    return (
      <li className="kivotos-links-chip" data-state="missing">
        {t(via === "tailscale" ? "chip.noTailnet" : "chip.noNetwork")}
      </li>
    );
  }
  return (
    <li className="kivotos-links-chip" data-state={link.state} title={linkText(t, link, now)}>
      {`${t(`via.${via}`)} · ${linkState(t, link)}`}
    </li>
  );
}

function ModeSegment({
  option,
  group,
  checked,
  noteId,
  t,
  onChange,
}: {
  option: ModeOption;
  /** The radio group's name. */
  group: string;
  checked: boolean;
  /** The control's "Unavailable: <reason>" line, which describes this option when it is down. */
  noteId: string;
  t: Translate;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}): ReactNode {
  return (
    <label
      className="kivotos-mode-option"
      data-checked={checked ? "" : undefined}
      data-unavailable={option.unavailable ? "" : undefined}
    >
      <input
        type="radio"
        name={group}
        value={option.mode}
        checked={checked}
        aria-describedby={option.unavailable ? noteId : undefined}
        onChange={onChange}
      />
      <span>{option.mode === "auto" ? t("mode.auto") : t(`via.${option.mode}`)}</span>
    </label>
  );
}

/**
 * How a machine reached both ways is reached: Auto, the links that work, and
 * the current choice even when its link is down (machines.ts `modeOptions`).
 */
function ModeControl({
  machine,
  options,
  hint,
  t,
  onChange,
}: {
  machine: MachineInfo;
  options: readonly ModeOption[];
  /** "Set on <computer>", where the page may be taken for the device's own setting. */
  hint: string | null;
  t: Translate;
  onChange: (id: string, mode: RouteMode) => void;
}): ReactNode {
  const group = useId();
  const hintId = useId();
  const noteId = useId();
  // Only the current choice is ever shown down (machines.ts `modeOptions`).
  const down = options.find((option) => option.unavailable)?.link;
  const choose = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const mode = event.currentTarget.value;
      if (isRouteMode(mode)) onChange(machine.id, mode);
    },
    [machine.id, onChange],
  );
  return (
    <div className="kivotos-mode">
      <div className="kivotos-mode-row">
        {hint === null ? null : (
          <span id={hintId} className="kivotos-mode-hint">
            {hint}
          </span>
        )}
        <div
          role="radiogroup"
          className="kivotos-mode-seg"
          aria-label={t("mode.label", { name: machine.name })}
          aria-describedby={hint === null ? undefined : hintId}
        >
          {options.map((option) => (
            <ModeSegment
              key={option.mode}
              option={option}
              group={group}
              checked={option.mode === machine.mode}
              noteId={noteId}
              t={t}
              onChange={choose}
            />
          ))}
        </div>
      </div>
      {down === undefined ? null : (
        <span id={noteId} className="kivotos-mode-note">
          {t("mode.unavailable", { reason: linkState(t, down) })}
        </span>
      )}
    </div>
  );
}

interface MachineRowProps {
  machine: MachineInfo;
  /** The links this computer has: one chip each. */
  vias: readonly Via[];
  hint: string | null;
  now: number;
  t: Translate;
  onChange: (id: string, mode: RouteMode) => void;
}

/** One machine: name, route or state, a chip per link, and its mode. */
function MachineRow({ machine, vias, hint, now, t, onChange }: MachineRowProps): ReactNode {
  const options = useMemo(() => modeOptions(machine, machine.mode), [machine]);
  return (
    <li className="kivotos-links-machine" data-reachable={String(machine.route !== null)}>
      <div className="kivotos-links-machine-head">
        <span className="kivotos-links-machine-name">{machine.name}</span>
        {machine.os === "" ? null : <span className="kivotos-links-machine-os">{machine.os}</span>}
      </div>
      <p className="kivotos-links-machine-status">{routeText(t, machine, now)}</p>
      {vias.length === 0 && options.length === 0 ? null : (
        <div className="kivotos-links-machine-foot">
          {vias.length === 0 ? null : (
            <ul className="kivotos-links-chips">
              {vias.map((via) => (
                <LinkChip
                  key={via}
                  via={via}
                  link={machine.links.find((link) => link.via === via)}
                  now={now}
                  t={t}
                />
              ))}
            </ul>
          )}
          {options.length === 0 ? null : (
            <ModeControl
              machine={machine}
              options={options}
              hint={hint}
              t={t}
              onChange={onChange}
            />
          )}
        </div>
      )}
    </li>
  );
}

function MachinesGroup({
  state,
  vias,
  inApp,
  t,
}: {
  state: LinksState;
  vias: readonly Via[];
  inApp: boolean;
  t: Translate;
}): ReactNode {
  const { list, changeMode } = state;
  const headingId = useId();
  // Re-rendered on every poll, which also moves "last seen" along.
  const now = Date.now();
  // In the phone app, whose own machine list has modes too: these are this page's computer's.
  const hint = inApp && list !== null ? t("mode.setOn", { name: list.self.name }) : null;
  let body: ReactNode;
  if (list === null) body = <p className="kivotos-links-text">{t("settings.loading")}</p>;
  else if (list.machines.length === 0)
    body = <p className="kivotos-links-text">{t("machines.none")}</p>;
  else {
    body = (
      <ul className="kivotos-links-list" aria-labelledby={headingId}>
        {list.machines.map((machine) => (
          <MachineRow
            key={machine.id}
            machine={machine}
            vias={vias}
            hint={hint}
            now={now}
            t={t}
            onChange={changeMode}
          />
        ))}
      </ul>
    );
  }
  return (
    <section className="kivotos-links-group">
      <h3 id={headingId} className="kivotos-links-heading">
        {t("settings.machines")}
      </h3>
      <p className="kivotos-links-text">{t("machines.intro")}</p>
      {body}
      {state.modeError === null ? null : (
        <p className="kivotos-links-error" role="alert">
          {state.modeError}
        </p>
      )}
    </section>
  );
}

const NO_VIAS: readonly Via[] = [];
const TAILSCALE: readonly Via[] = ["tailscale"];
const RELAY: readonly Via[] = ["relay"];
const BOTH: readonly Via[] = ["tailscale", "relay"];

/**
 * The section body: this machine's links, then the machines it knows.
 * @param inApp - the page runs in the Kivotos phone app (client.tsx IN_APP).
 */
export function LinksSection({ t, inApp }: { t: Translate; inApp: boolean }): ReactNode {
  const state = useLinks(t);
  const headingId = useId();
  const { links } = state;
  if (links === null) {
    return (
      <div className="kivotos-links">
        <p className="kivotos-links-text">
          {t(state.failed ? "settings.failed" : "settings.loading")}
        </p>
      </div>
    );
  }
  // A machine gets a chip for each link this computer has, and none for the others.
  let vias = NO_VIAS;
  if (links.tailscale.joined) vias = links.relay.joined ? BOTH : TAILSCALE;
  else if (links.relay.joined) vias = RELAY;
  return (
    <div className="kivotos-links">
      <section className="kivotos-links-group">
        <h3 id={headingId} className="kivotos-links-heading">
          {t("settings.links")}
        </h3>
        <ul className="kivotos-links-list" aria-labelledby={headingId}>
          <TailscaleLine links={links} inApp={inApp} t={t} />
          <RelayLine state={state} relay={links.relay} t={t} />
        </ul>
      </section>
      <MachinesGroup state={state} vias={vias} inApp={inApp} t={t} />
    </div>
  );
}
