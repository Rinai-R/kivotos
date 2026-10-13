/** UI strings of the app's own screens (everything else is dsh's UI). */
import {
  agoOf,
  pinnedVia,
  statusOf,
  type MachineLink,
  type PhoneMachineProbe,
  type RouteMode,
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
  manual: "Enter address manually",
  manualShort: "Type address",
  manualHint: "Use the computer's Tailscale IP (not the phone's), or paste a relay invite link.",
  addPlaceholder: "100.64.0.1",
  add: "Add",
  adding: "Connecting…",
  removeHint: "Long-press a machine to choose how it is reached, or to remove it",
  remove: "Remove",
  removeConfirm: "Remove {name}?",
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
  checking: "Checking…",
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
  "reason.not-on-tailnet": "Tailscale is not connected on this phone",
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
  "status.offline": "Offline",
  "status.offlineSince": "Offline · last seen {ago}",
  "status.unreachable": "Unreachable: {reason}",
  "status.lastSeen": "last seen {ago}",
  "mode.title": "How this phone reaches it",
  "mode.auto": "Auto",
  streamDown: "Notifications not connected",
  connections: "Connections",
  connectionsMeta: "Tailscale · Own relay",
  linksTailscale: "Tailscale",
  linksTailscaleNone: "No machine added by address",
  linksTailscaleCount: "{count} of {total} reachable over Tailscale",
  linksTailscaleDown:
    "Tailscale is not connected on this phone. Open the Tailscale app and connect.",
  linksTailscaleHint:
    "Machines added by pairing code or address are reached over the tailnet, through the computer's Kivotos listener.",
  linksRelay: "Own relay",
  linksRelayIntro:
    "Connect through a relay server you run, without Tailscale. On a computer, open Machines → Connections → Own relay to get the invite.",
  linksRelayAddress: "Relay",
  linksRelayNetwork: "Network",
  linksStatus: "Status",
  linksRelayMachines: "Machines online",
  "relayState.connecting": "Connecting…",
  "relayState.online": "Connected",
  "relayState.denied": "The relay does not know this network",
  "relayState.unreachable": "Cannot reach the relay",
  linksInvitePlaceholder: "kivotos://join?…",
  linksJoin: "Join",
  linksScan: "Scan invite code",
  linksLeave: "Leave network",
  leaveConfirm: "Leave this network?",
  leaveDetail:
    "Computers only this network reaches leave the list; the others keep their Tailscale address.",
  leave: "Leave",
  notifications: "Notifications",
  notificationsOn: "Approvals, questions and finished tasks",
  notificationsOff: "Off",
  notificationsDenied: "Blocked in Android settings",
  batteryHint: "Android may stop notifications to save battery.",
  batteryFix: "Allow in background",
  loading: "Connecting to {name}…",
  offline: "Cannot load {name}",
  offlineDetail: "Check that dsh is running on the computer and Tailscale is connected.",
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
  removeHint: "长按机器可选择连接方式或移除",
  remove: "移除",
  removeConfirm: "移除 {name}？",
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
  checking: "正在检查…",
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
  "reason.not-on-tailnet": "这台手机未连接 Tailscale",
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
  "status.offline": "离线",
  "status.offlineSince": "离线 · 最后在线 {ago}",
  "status.unreachable": "无法连接：{reason}",
  "status.lastSeen": "最后在线 {ago}",
  "mode.title": "这台手机如何连接它",
  "mode.auto": "自动",
  streamDown: "通知未连接",
  connections: "连接",
  connectionsMeta: "Tailscale · 自建中继",
  linksTailscale: "Tailscale",
  linksTailscaleNone: "没有按地址添加的机器",
  linksTailscaleCount: "{total} 台中有 {count} 台可经 Tailscale 连接",
  linksTailscaleDown: "这台手机未连接 Tailscale。请打开 Tailscale 应用并连接。",
  linksTailscaleHint: "用配对码或地址添加的机器经 tailnet 连接，通过电脑上的 Kivotos 监听。",
  linksRelay: "自建中继",
  linksRelayIntro:
    "通过你自己部署的中继服务器连接，不依赖 Tailscale。在电脑上打开 机器 → 连接 → 自建中继 获取邀请。",
  linksRelayAddress: "中继",
  linksRelayNetwork: "网络",
  linksStatus: "状态",
  linksRelayMachines: "在线机器",
  "relayState.connecting": "正在连接…",
  "relayState.online": "已连接",
  "relayState.denied": "中继不认识这个网络",
  "relayState.unreachable": "无法连接中继",
  linksInvitePlaceholder: "kivotos://join?…",
  linksJoin: "加入",
  linksScan: "扫描邀请码",
  linksLeave: "退出网络",
  leaveConfirm: "退出这个网络？",
  leaveDetail: "只经由这个网络连接的电脑会从列表中移除，其它电脑保留 Tailscale 地址。",
  leave: "退出",
  notifications: "通知",
  notificationsOn: "审批、提问和任务完成时提醒你",
  notificationsOff: "已关闭",
  notificationsDenied: "已在系统设置中关闭",
  batteryHint: "安卓可能为省电而停止通知。",
  batteryFix: "允许后台运行",
  loading: "正在连接 {name}…",
  offline: "无法加载 {name}",
  offlineDetail: "请确认电脑上的 dsh 正在运行，且 Tailscale 已连接。",
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

/** One link's state: why it fails, else its state. */
function linkState(link: MachineLink): string {
  return link.reason === undefined ? t(`state.${link.state}`) : t(`reason.${link.reason}`);
}

/** One link's line in the mode sheet, worded like the computer's mode menu (`linkText`). */
export function linkLine(link: MachineLink, now: number): string {
  const state =
    link.state === "unreachable" && link.reason !== undefined
      ? t("status.unreachable", { reason: t(`reason.${link.reason}`) })
      : t(`state.${link.state}`);
  return link.state !== "online" && link.lastSeen !== undefined
    ? `${state} · ${t("status.lastSeen", { ago: agoText(link.lastSeen, now) })}`
    : state;
}

/**
 * How the phone reaches a machine in `mode`, worded like the computer's
 * switcher (packages/kivotos/src/connections.tsx `statusText`).
 */
export function routeLine(probe: PhoneMachineProbe, mode: RouteMode, now: number): string {
  const pinned = pinnedVia(probe, mode);
  const status = statusOf(probe, mode);
  let line: string;
  switch (status.kind) {
    case "online": {
      const via = t(`via.${status.via}`);
      if (pinned !== null) return t("status.viaOnly", { via });
      return status.down === undefined
        ? t("status.via", { via })
        : t("status.fallback", {
            via,
            down: t(`via.${status.down.via}`),
            reason: linkState(status.down),
          });
    }
    case "offline":
      line =
        status.lastSeen === undefined
          ? t("status.offline")
          : t("status.offlineSince", { ago: agoText(status.lastSeen, now) });
      break;
    case "unreachable":
      line = t("status.unreachable", { reason: linkState(status.link) });
      break;
    case "denied":
      line = t("state.denied");
      break;
  }
  return pinned === null ? line : t("status.only", { via: t(`via.${pinned}`), status: line });
}

/** A machine row's status line: {@link routeLine}, plus its notification stream. */
export function statusLine(
  probe: PhoneMachineProbe | undefined,
  mode: RouteMode,
  now: number,
): string {
  if (probe === undefined) return t("checking");
  const line = routeLine(probe, mode, now);
  return probe.stream === "down" && statusOf(probe, mode).kind === "online"
    ? `${line} · ${t("streamDown")}`
    : line;
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
