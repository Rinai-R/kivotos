/** UI strings of the app's own screens (everything else is dsh's UI). */
import {
  agoOf,
  pinnedVia,
  statusOf,
  type LinkDown,
  type MachineLink,
  type PhoneMachineProbe,
  type RouteMode,
  type Via,
} from "../../kivotos/src/machines";
import { zh } from "./machines";

const en = {
  tagline: "Every dsh you connect, in your pocket",
  sectionMachines: "Machines",
  sectionSettings: "Settings",
  emptyTitle: "Connect your first computer",
  emptyStep1:
    "On the computer, open Machines at the bottom of the dsh sidebar and choose Pair phone.",
  emptyStep2: "Tap Scan to pair below and point the camera at the code.",
  scan: "Scan to pair",
  scanHint: "Point the camera at the pairing or invite code Kivotos shows on your computer",
  manual: "Enter address",
  manualShort: "Type address",
  manualHint: "Use the computer's Tailscale IP (not the phone's), or paste a relay invite link.",
  addPlaceholder: "100.64.0.1",
  add: "Add",
  adding: "Connecting…",
  removeHint: "Long-press a machine: route, remove",
  cancel: "Cancel",
  close: "Close",
  scanInvalid: "This is not a Kivotos pairing code.",
  cameraDenied: "Camera access is off. Allow it to scan, or enter the address manually.",
  cameraUnavailable: "The camera could not start.",
  cameraSettings: "Open settings",
  retry: "Try again",
  errorForbidden:
    "The computer refused this phone. Sign the phone in to the same Tailscale account.",
  errorNotKivotos: "Something answered, but it is not Kivotos. Check the port (default 7380).",
  errorUnreachable:
    "Cannot reach this address. Check that Tailscale is on and dsh with Kivotos is running.",
  errorInvalid: "Not a valid address.",
  duplicate: "This machine is already in the list.",
  relayInvite: "This is not a valid Kivotos invite link.",
  relayDenied: "The relay does not know this network. Register it on the relay server first.",
  relayUnreachable: "Cannot reach the relay server. Check its address and your connection.",
  relayEmpty: "No computer of this network is online. Start dsh with Kivotos on one and try again.",
  "via.tailscale": "Tailscale",
  "via.relay": "Relay",
  "state.online": "Online",
  "state.unstable": "Unstable",
  "state.checking": "Checking",
  "state.offline": "Offline",
  "state.unreachable": "Unreachable",
  "state.denied": "Not registered",
  "reason.no-listener": "Not running",
  "reason.not-kivotos": "Port in use",
  "reason.forbidden": "Refused",
  "reason.timeout": "No reply",
  "reason.tls": "TLS error",
  "reason.tls-reset": "Reset",
  "reason.network": "Failed",
  "reason.not-on-tailnet": "Off tailnet",
  "reason.relay-connecting": "Relay connecting",
  "reason.relay-unreachable": "Relay down",
  "ago.now": "just now",
  "ago.minutes": "{count} min ago",
  "ago.hours": "{count} h ago",
  "ago.days": "{count} d ago",
  sheetLinks: "Links",
  "mode.title": "How this phone reaches it",
  "mode.auto": "Auto",
  "mode.tailscale": "Tailscale only",
  "mode.relay": "Relay only",
  "modeDesc.auto": "Falls back to the relay",
  "modeDesc.tailscale": "No fallback",
  "modeDesc.relay": "No fallback",
  "mode.unavailable": "Unavailable now: {reason}",
  sheetSource: "Relay network",
  sheetRemove: "Remove from this phone",
  removeTitle: "Remove {name}?",
  removeBody: "This phone forgets {address}. You can pair it again later.",
  remove: "Remove",
  connections: "Connections",
  connectionsMeta: "Tailscale · Own relay",
  tailscale: "Tailscale",
  "tsTag.ok": "Answering",
  "tsTag.down": "No answer",
  tsDown: "No machine answers over Tailscale",
  tsOpen: "Open Tailscale",
  tsNone: "No machine added by address",
  relay: "Own relay",
  "relayTag.online": "Connected",
  "relayTag.connecting": "Connecting",
  "relayTag.denied": "Not registered",
  "relayTag.unreachable": "Relay unreachable",
  "relayTag.none": "Not joined",
  resetLead: "Connection reset",
  resetBody: "the host may be blocking this domain",
  relayOnline: "Computers online",
  relayLeave: "Leave network",
  relayScan: "Scan invite code",
  relayPaste: "Or paste an invite link",
  invitePlaceholder: "kivotos://join?…",
  relayJoin: "Join",
  relayWhere: "Invites are in Remote access → Invite on a computer",
  "joinError.invalid": "Not a Kivotos invite link",
  "joinError.denied": "The relay hasn't registered this network",
  "joinError.unreachable": "Can't reach the relay {host}",
  "joinError.empty": "No computer in this network is online",
  leaveTitle: "Leave this network?",
  leaveBody: "This phone leaves the network on {host}.",
  leaveLoseOne:
    "{names}, reached only through the relay, leaves the list; the others keep their Tailscale address.",
  leaveLoseMany:
    "{names}, reached only through the relay, leave the list; the others keep their Tailscale address.",
  leaveKeep: "Every machine keeps its Tailscale address.",
  leaveConfirm: "Leave network",
  nameSeparator: ", ",
  notifications: "Notifications",
  notificationsDenied: "Notifications are off in Android settings",
  batteryHint: "Android's battery settings restrict background use",
  batteryFix: "Allow in background",
  loading: "Connecting to {name}…",
  offline: "Cannot load {name}",
  offlineDetail: "Check that dsh is running on the computer and Tailscale is connected.",
  offlineLink: "{via}: {reason}",
  back: "Machines",
};

const zhText: typeof en = {
  tagline: "随身使用你连接的每一个 dsh",
  sectionMachines: "机器",
  sectionSettings: "设置",
  emptyTitle: "连接第一台电脑",
  emptyStep1: "在电脑的 dsh 中，打开侧边栏底部的「机器」，选择「配对手机」。",
  emptyStep2: "点下方「扫码配对」，对准电脑上的二维码。",
  scan: "扫码配对",
  scanHint: "对准电脑上 Kivotos 显示的配对码或邀请码",
  manual: "手动输入地址",
  manualShort: "手动输入",
  manualHint: "填写电脑的 Tailscale IP（不是手机的），或粘贴中继邀请链接。",
  addPlaceholder: "100.64.0.1",
  add: "添加",
  adding: "连接中…",
  removeHint: "长按机器：连接方式、移除",
  cancel: "取消",
  close: "关闭",
  scanInvalid: "这不是 Kivotos 配对码。",
  cameraDenied: "相机权限未开启。请授权后扫码，或手动输入地址。",
  cameraUnavailable: "无法启动相机。",
  cameraSettings: "打开设置",
  retry: "重试",
  errorForbidden: "电脑拒绝了这台手机。请让手机登录同一个 Tailscale 账号。",
  errorNotKivotos: "该地址有响应，但不是 Kivotos。请检查端口（默认 7380）。",
  errorUnreachable: "无法连接。请确认 Tailscale 已开启，且电脑上运行着装有 Kivotos 的 dsh。",
  errorInvalid: "地址格式不对。",
  duplicate: "这台机器已经在列表里了。",
  relayInvite: "这不是有效的 Kivotos 邀请链接。",
  relayDenied: "中继不认识这个网络。请先在中继服务器上登记。",
  relayUnreachable: "无法连接中继服务器。请检查地址和网络。",
  relayEmpty: "这个网络里没有在线的电脑。请先在一台电脑上运行装有 Kivotos 的 dsh。",
  "via.tailscale": "Tailscale",
  "via.relay": "中继",
  "state.online": "在线",
  "state.unstable": "不稳定",
  "state.checking": "检查中",
  "state.offline": "离线",
  "state.unreachable": "无法连接",
  "state.denied": "网络未登记",
  "reason.no-listener": "未运行 Kivotos",
  "reason.not-kivotos": "端口被占用",
  "reason.forbidden": "被拒绝",
  "reason.timeout": "没有响应",
  "reason.tls": "TLS 错误",
  "reason.tls-reset": "连接被重置",
  "reason.network": "连接失败",
  "reason.not-on-tailnet": "本机未连接",
  "reason.relay-connecting": "中继连接中",
  "reason.relay-unreachable": "连不上中继",
  "ago.now": "刚刚",
  "ago.minutes": "{count}\u00a0分钟前",
  "ago.hours": "{count}\u00a0小时前",
  "ago.days": "{count}\u00a0天前",
  sheetLinks: "连接",
  "mode.title": "这台手机如何连接它",
  "mode.auto": "自动",
  "mode.tailscale": "仅 Tailscale",
  "mode.relay": "仅中继",
  "modeDesc.auto": "不通时改走中继",
  "modeDesc.tailscale": "不改道",
  "modeDesc.relay": "不改道",
  "mode.unavailable": "现在不可用：{reason}",
  sheetSource: "中继网络",
  sheetRemove: "从这台手机移除",
  removeTitle: "移除 {name}？",
  removeBody: "这台手机会忘掉 {address}。以后可以重新扫码配对。",
  remove: "移除",
  connections: "连接",
  connectionsMeta: "Tailscale · 自建中继",
  tailscale: "Tailscale",
  "tsTag.ok": "有回应",
  "tsTag.down": "无回应",
  tsDown: "机器都没有回应 Tailscale",
  tsOpen: "打开 Tailscale",
  tsNone: "没有按地址添加的机器",
  relay: "自建中继",
  "relayTag.online": "已连接",
  "relayTag.connecting": "连接中",
  "relayTag.denied": "等待登记",
  "relayTag.unreachable": "连不上中继",
  "relayTag.none": "未加入",
  resetLead: "连接被重置",
  resetBody: "服务商可能在屏蔽此域名",
  relayOnline: "在线的电脑",
  relayLeave: "退出网络",
  relayScan: "扫描邀请码",
  relayPaste: "或粘贴邀请链接",
  invitePlaceholder: "kivotos://join?…",
  relayJoin: "加入",
  relayWhere: "邀请在电脑的「远程连接」→「邀请设备」",
  "joinError.invalid": "不是 Kivotos 邀请链接",
  "joinError.denied": "中继没有登记这个网络",
  "joinError.unreachable": "连不上中继 {host}",
  "joinError.empty": "这个网络没有在线的电脑",
  leaveTitle: "退出这个网络？",
  leaveBody: "这台手机会离开 {host} 上的网络。",
  leaveLoseOne: "只经中继连接的 {names} 会从列表中移除；其它机器保留 Tailscale 地址。",
  leaveLoseMany: "只经中继连接的 {names} 会从列表中移除；其它机器保留 Tailscale 地址。",
  leaveKeep: "所有机器保留 Tailscale 地址。",
  leaveConfirm: "退出网络",
  nameSeparator: "、",
  notifications: "通知",
  notificationsDenied: "通知已在系统设置中关闭",
  batteryHint: "安卓的省电设置限制了后台运行",
  batteryFix: "允许后台运行",
  loading: "正在连接 {name}…",
  offline: "无法加载 {name}",
  offlineDetail: "请确认电脑上的 dsh 正在运行，且 Tailscale 已连接。",
  offlineLink: "{via}：{reason}",
  back: "机器",
};

export type Key = keyof typeof en;

export function t(key: Key, params: Record<string, string> = {}): string {
  const template = (zh ? zhText : en)[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

function agoText(time: number, now: number): string {
  const ago = agoOf(time, now);
  return ago.unit === "now" ? t("ago.now") : t(`ago.${ago.unit}`, { count: String(ago.count) });
}

/**
 * A state dot's tone: working, working but missing its latest checks, not
 * working, away, or not known yet. `theme.ts` gives each its colour.
 */
export type Dot = "online" | "unstable" | "down" | "idle" | "checking";

/** @returns the dot of one link; undefined is a link not probed yet. */
export function dotOf(link: MachineLink | undefined): Dot {
  if (link === undefined) return "checking";
  if (link.state === "online") return link.unstable === true ? "unstable" : "online";
  return link.state === "offline" ? "idle" : "down";
}

/** Why a link does not work, in a word or two (machines.ts `downOf`). */
export function downText(down: LinkDown): string {
  return down === "offline" || down === "unreachable" || down === "denied"
    ? t(`state.${down}`)
    : t(`reason.${down}`);
}

/** Why a page's door could not reach its machine, one line: each link tried and why it failed. */
export function doorText(failures: readonly { via: Via; reason: LinkDown }[]): string {
  return failures
    .map(({ via, reason }) => t("offlineLink", { via: t(`via.${via}`), reason: downText(reason) }))
    .join(" · ");
}

/**
 * One link of a machine in a few words: its state, then the short reason
 * when it is unreachable, or when it was last seen when it is offline.
 */
export function linkText(link: MachineLink, now: number): string {
  switch (link.state) {
    case "online":
      return t(link.unstable === true ? "state.unstable" : "state.online");
    case "offline":
      return link.lastSeen === undefined
        ? t("state.offline")
        : `${t("state.offline")} · ${agoText(link.lastSeen, now)}`;
    case "denied":
      return t("state.denied");
    case "unreachable":
      return link.reason === undefined
        ? t("state.unreachable")
        : `${t("state.unreachable")} · ${t(`reason.${link.reason}`)}`;
  }
}

/**
 * A machine row's dot and word, as the computer's machine switcher says it
 * (machines.ts `statusOf`): the route, or the mode when it holds the machine
 * to one link; Unstable; how long ago it was seen when it is offline; else
 * the short reason it is unreachable.
 * @param probe - what the last probe found; undefined before the first one.
 */
export function summaryOf(
  probe: PhoneMachineProbe | undefined,
  mode: RouteMode,
  now: number,
): { dot: Dot; text: string } {
  if (probe === undefined) return { dot: "checking", text: t("state.checking") };
  const status = statusOf(probe, mode);
  switch (status.kind) {
    case "online": {
      const pinned = pinnedVia(probe, mode);
      return { dot: "online", text: t(pinned === null ? `via.${status.via}` : `mode.${pinned}`) };
    }
    case "unstable":
      return { dot: "unstable", text: t("state.unstable") };
    case "offline":
      return {
        dot: "idle",
        text: status.lastSeen === undefined ? t("state.offline") : agoText(status.lastSeen, now),
      };
    case "unreachable":
      return { dot: "down", text: downText(status.link.reason ?? "unreachable") };
    case "denied":
      return { dot: "down", text: t("state.denied") };
  }
}

/** The message for a failed attempt to add machines (`resolveMachines`). */
export function errorKey(error: unknown): Key {
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, Key> = {
    forbidden: "errorForbidden",
    "not-kivotos": "errorNotKivotos",
    duplicate: "duplicate",
    invalid: "errorInvalid",
    "scan-invalid": "scanInvalid",
    "relay-invite": "relayInvite",
    "relay-denied": "relayDenied",
    "relay-unreachable": "relayUnreachable",
    "relay-empty": "relayEmpty",
  };
  return known[message] ?? "errorUnreachable";
}

/** The one-line message for a failed join on the Connections screen (`resolveMachines`). */
export function joinErrorKey(error: unknown): Key {
  const message = error instanceof Error ? error.message : "";
  const known: Record<string, Key> = {
    duplicate: "duplicate",
    "relay-invite": "joinError.invalid",
    "relay-denied": "joinError.denied",
    "relay-empty": "joinError.empty",
  };
  return known[message] ?? "joinError.unreachable";
}
