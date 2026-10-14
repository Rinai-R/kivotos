/**
 * The Kivotos section of dsh Settings, one page: this computer's links (a
 * card row each, with a tag, its facts, labelled actions and the notices that
 * apply now), then a table of the machines it knows, with a cell per link and,
 * for a machine reached both ways, its connection mode. The links are
 * independent; a machine can use both at once. The text helpers here word the
 * machine model (machines.ts) for the switcher too.
 */
import QrCode from "qrcode-generator";
import * as React from "react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  agoOf,
  downOf,
  isRouteMode,
  modeOptions,
  pinnedVia,
  statusOf,
  type LinkDown,
  type LinkReason,
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
  "settings.loading": "正在读取…",
  "settings.failed": "无法读取连接状态",
  "links.label": "本机的连接方式",
  "notice.sep": "：",
  "notice.failed": "{lead}：{error}",
  copy: "复制",
  copied: "已复制",
  cancel: "取消",
  done: "完成",
  close: "关闭",
  "ts.name": "Tailscale",
  "ts.tag.on": "已连接",
  "ts.tag.off": "未连接",
  "ts.tag.starting": "正在启动",
  "ts.tag.disabled": "已关闭",
  "ts.meta.device": "本机 {name}",
  "ts.meta.listen": "监听 {address}",
  "ts.meta.off": "本机未登录 Tailscale",
  "ts.meta.starting": "等待监听就绪",
  "ts.meta.disabled": "配置 listen: false",
  "pair.action": "配对手机",
  "pair.unavailable": "此机器的远程连接尚未就绪",
  "pair.title": "配对手机",
  "pair.instructions": "用手机上的 Kivotos 扫描此二维码，或手动输入下方地址。",
  "pair.qr": "用于配对手机的二维码",
  "pair.address": "配对地址",
  "pair.close": "关闭",
  "relay.name": "自建中继",
  "relay.tag.on": "已连接",
  "relay.tag.connecting": "连接中",
  "relay.tag.denied": "等待登记",
  "relay.tag.unreachable": "连不上中继",
  "relay.tag.none": "未加入",
  "relay.meta.online": "{count} 台机器在线",
  "relay.invite": "邀请设备",
  "relay.leave": "退出网络",
  "setup.join.title": "加入已有网络",
  "setup.join.ph": "kivotos://join?…",
  "setup.join.btn": "加入",
  "setup.create.title": "创建新网络",
  "setup.create.ph": "relay.example.net",
  "setup.create.btn": "创建",
  "setup.joinFailed": "没能加入网络",
  "setup.createFailed": "没能创建网络",
  "notice.register.lead": "在中继上登记这个网络",
  "notice.register.body": "请中继管理员执行一次：",
  "notice.reset.lead": "连接被重置",
  "notice.reset.body": "服务商可能在屏蔽此域名",
  "notice.plain.lead": "明文 ws://",
  "notice.plain.body": "中继令牌可被窃听，请改用 wss://",
  "machines.label": "机器",
  "machines.count": "{count} 台",
  "machines.none": "还没有其它机器",
  "col.machine": "机器",
  "col.tailscale": "Tailscale",
  "col.relay": "中继",
  "col.mode": "连接方式",
  "via.tailscale": "Tailscale",
  "via.relay": "中继",
  "mode.auto": "自动",
  "mode.tailscale": "仅 Tailscale",
  "mode.relay": "仅中继",
  "mode.auto.desc": "不通时改走中继",
  "mode.tailscale.desc": "不改道",
  "mode.relay.desc": "不改道",
  "mode.unavailable": "现在不可用：{reason}",
  "mode.only": "唯一方式",
  "mode.menu.label": "{name} 的连接方式",
  "mode.failed": "无法更改连接方式",
  "ago.now": "刚刚",
  "ago.minutes": "{count} 分钟前",
  "ago.hours": "{count} 小时前",
  "ago.days": "{count} 天前",
  "tip.head": "{link}：{word}",
  "tip.headUsed": "{link}：{word}，正在使用",
  "tip.lastSeen": "最后在线 {ago}",
  "state.online": "在线",
  "state.unstable": "不稳定",
  "state.unstable.tip": "最近的检查没有响应，仍在使用；连续 3 次失败后改走中继。",
  "state.unstable-pinned.tip": "最近的检查没有响应，仍在使用；连续 3 次失败后算作无法连接。",
  "state.offline": "离线",
  "state.unreachable": "无法连接",
  "state.denied": "网络未登记",
  "state.denied.tip": "中继 {host} 还没有登记这个网络。",
  "state.none": "未加入",
  "state.none-tailscale.tip": "{name} 不在这个 tailnet 上。",
  "state.none-relay.tip": "{name} 不在这个中继网络里。",
  "reason.timeout": "没有响应",
  "reason.timeout.tip": "{address} 连续 3 次没有响应，每次等 6 秒。",
  "reason.no-listener": "未运行 Kivotos",
  "reason.no-listener.tip": "{address} 拒绝连接：没有 Kivotos 在监听。",
  "reason.not-kivotos": "端口被占用",
  "reason.not-kivotos.tip": "{address} 上回应的是别的服务，不是 Kivotos。",
  "reason.forbidden": "被拒绝",
  "reason.forbidden.tip": "那台电脑只接受自己的 tailnet 用户，拒绝了这台电脑。",
  "reason.tls": "TLS 错误",
  "reason.tls.tip": "和 {address} 的 TLS 没有建立：证书不对或已更换。",
  "reason.tls-reset": "连接被重置",
  "reason.tls-reset.tip": "TLS 握手被重置：托管服务商可能在屏蔽这个域名。",
  "reason.network": "连接失败",
  "reason.network.tip": "连接 {address} 失败。",
  "reason.not-on-tailnet": "本机未连接",
  "reason.not-on-tailnet.tip": "这台电脑没有连接 Tailscale。",
  "reason.relay-connecting": "中继连接中",
  "reason.relay-connecting.tip": "这台电脑还在连接中继。",
  "reason.relay-unreachable": "连不上中继",
  "reason.relay-unreachable.tip": "这台电脑连不上中继 {host}。",
  "invite.title": "邀请设备加入网络",
  "invite.desc": "拿到这个邀请的人都能加入网络，请像密码一样保管。",
  "invite.phone": "手机",
  "invite.phone.how": "在 Kivotos 应用里打开「连接」→「扫描邀请码」，扫这个二维码。",
  "invite.computer": "其它电脑",
  "invite.computer.how": "打开「设置」→「远程连接」，把下面的链接粘贴到「加入已有网络」。",
  "invite.link": "邀请链接",
  "invite.qr": "加入网络的二维码",
  "leave.title": "退出中继网络？",
  "leave.desc": "这台电脑会离开 {host} 上的网络。",
  "leave.lose": "只能经中继连接的机器（{names}）将无法从这台电脑打开。",
  "leave.names": "、",
  "leave.others": "其它设备也不能再经中继打开这台电脑。",
  "leave.key": "本机保存的网络密钥会被删除，回来需要新的邀请。",
  "leave.keep": "网络本身和其它成员不受影响。",
  "leave.failed": "没能退出网络",
  "leave.confirm": "退出网络",
};

export const SETTINGS_EN: Record<keyof typeof SETTINGS_ZH, string> = {
  "settings.nav": "Remote access",
  "settings.loading": "Loading…",
  "settings.failed": "Couldn't read the connection state",
  "links.label": "How this computer connects",
  "notice.sep": ": ",
  "notice.failed": "{lead}: {error}",
  copy: "Copy",
  copied: "Copied",
  cancel: "Cancel",
  done: "Done",
  close: "Close",
  "ts.name": "Tailscale",
  "ts.tag.on": "Connected",
  "ts.tag.off": "Not connected",
  "ts.tag.starting": "Starting",
  "ts.tag.disabled": "Off",
  "ts.meta.device": "This computer: {name}",
  "ts.meta.listen": "Listening on {address}",
  "ts.meta.off": "Not signed in on this computer",
  "ts.meta.starting": "Waiting for the listener",
  "ts.meta.disabled": "Config: listen: false",
  "pair.action": "Pair phone",
  "pair.unavailable": "This machine's remote listener is not ready.",
  "pair.title": "Pair phone",
  "pair.instructions": "Scan this code with Kivotos on your phone, or enter the address below.",
  "pair.qr": "QR code for pairing a phone",
  "pair.address": "Pairing address",
  "pair.close": "Close",
  "relay.name": "Own relay",
  "relay.tag.on": "Connected",
  "relay.tag.connecting": "Connecting",
  "relay.tag.denied": "Not registered",
  "relay.tag.unreachable": "Relay unreachable",
  "relay.tag.none": "Not joined",
  "relay.meta.online": "{count} machines online",
  "relay.invite": "Invite",
  "relay.leave": "Leave network",
  "setup.join.title": "Join a network",
  "setup.join.ph": "kivotos://join?…",
  "setup.join.btn": "Join",
  "setup.create.title": "Create a network",
  "setup.create.ph": "relay.example.net",
  "setup.create.btn": "Create",
  "setup.joinFailed": "Couldn't join the network",
  "setup.createFailed": "Couldn't create the network",
  "notice.register.lead": "Register this network on the relay",
  "notice.register.body": "Ask the relay's operator to run once:",
  "notice.reset.lead": "Connection reset",
  "notice.reset.body": "the hosting provider may be blocking this domain",
  "notice.plain.lead": "Plaintext ws://",
  "notice.plain.body": "the relay token can be read in transit; use wss://",
  "machines.label": "Machines",
  "machines.count": "{count}",
  "machines.none": "No other machines yet",
  "col.machine": "Machine",
  "col.tailscale": "Tailscale",
  "col.relay": "Relay",
  "col.mode": "Route",
  "via.tailscale": "Tailscale",
  "via.relay": "Relay",
  "mode.auto": "Auto",
  "mode.tailscale": "Tailscale only",
  "mode.relay": "Relay only",
  "mode.auto.desc": "Falls back to the relay",
  "mode.tailscale.desc": "No fallback",
  "mode.relay.desc": "No fallback",
  "mode.unavailable": "Unavailable now: {reason}",
  "mode.only": "Only link",
  "mode.menu.label": "How this computer reaches {name}",
  "mode.failed": "Couldn't change the route",
  "ago.now": "just now",
  "ago.minutes": "{count} min ago",
  "ago.hours": "{count} h ago",
  "ago.days": "{count} d ago",
  "tip.head": "{link}: {word}",
  "tip.headUsed": "{link}: {word}, in use",
  "tip.lastSeen": "last seen {ago}",
  "state.online": "Online",
  "state.unstable": "Unstable",
  "state.unstable.tip":
    "Missed its latest checks, still in use; after 3 failures in a row it switches to the relay.",
  "state.unstable-pinned.tip":
    "Missed its latest checks, still in use; after 3 failures in a row it counts as unreachable.",
  "state.offline": "Offline",
  "state.unreachable": "Unreachable",
  "state.denied": "Not registered",
  "state.denied.tip": "The relay {host} hasn't registered this network.",
  "state.none": "Not joined",
  "state.none-tailscale.tip": "{name} is not on this tailnet.",
  "state.none-relay.tip": "{name} is not in this relay network.",
  "reason.timeout": "No reply",
  "reason.timeout.tip": "No reply from {address} to 3 checks in a row, 6 s each.",
  "reason.no-listener": "Not running",
  "reason.no-listener.tip": "{address} refused the connection: nothing is listening.",
  "reason.not-kivotos": "Port in use",
  "reason.not-kivotos.tip": "Another service answered at {address}, not Kivotos.",
  "reason.forbidden": "Refused",
  "reason.forbidden.tip": "That computer only accepts its own tailnet user and refused this one.",
  "reason.tls": "TLS error",
  "reason.tls.tip": "TLS with {address} failed: the certificate is wrong or has changed.",
  "reason.tls-reset": "Reset",
  "reason.tls-reset.tip":
    "The TLS handshake was reset: the hosting provider may be blocking this domain.",
  "reason.network": "Failed",
  "reason.network.tip": "Connecting to {address} failed.",
  "reason.not-on-tailnet": "Off tailnet",
  "reason.not-on-tailnet.tip": "This computer is not on the tailnet.",
  "reason.relay-connecting": "Relay connecting",
  "reason.relay-connecting.tip": "This computer is still connecting to the relay.",
  "reason.relay-unreachable": "Relay down",
  "reason.relay-unreachable.tip": "This computer can't reach the relay {host}.",
  "invite.title": "Invite a device to this network",
  "invite.desc": "Anyone with this invite can join the network. Keep it like a password.",
  "invite.phone": "Phone",
  "invite.phone.how": "In the Kivotos app, open Connections → Scan invite code and scan this.",
  "invite.computer": "Another computer",
  "invite.computer.how":
    "Open Settings → Remote access and paste the link below into Join a network.",
  "invite.link": "Invite link",
  "invite.qr": "QR code to join the network",
  "leave.title": "Leave the relay network?",
  "leave.desc": "This computer leaves the network on {host}.",
  "leave.lose":
    "Machines reached only through the relay ({names}) can no longer be opened from this computer.",
  "leave.names": ", ",
  "leave.others": "Other devices can no longer reach this computer through the relay.",
  "leave.key": "The network key saved here is deleted; coming back needs a new invite.",
  "leave.keep": "The network itself and its other members are not affected.",
  "leave.failed": "Couldn't leave the network",
  "leave.confirm": "Leave network",
};

export const SETTINGS_CSS = `
.kivotos-links{container-type:inline-size;display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px}
.kivotos-title{margin:0;font-size:16px;font-weight:500;line-height:24px}
.kivotos-group{display:flex;flex-direction:column;gap:8px;min-width:0}
.kivotos-group-head{display:flex;align-items:baseline;gap:6px;margin:0}
.kivotos-group-label{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;font-weight:500;line-height:20px}
.kivotos-group-count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.kivotos-card{margin:0;padding:0;list-style:none;border:0.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);min-width:0}
.kivotos-card-list{margin:0;padding:0;list-style:none}
.kivotos-text{margin:0;display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.kivotos-icon{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
.kivotos-tile{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary)}
.kivotos-mono{font-family:var(--ds-font-family-code,monospace);font-size:13px;color:var(--dsw-alias-label-secondary)}
.kivotos-spin{flex:none;width:10px;height:10px;animation:kivotos-spin 0.9s linear infinite}
.kivotos-spin circle{fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
.kivotos-spin circle:first-child{opacity:0.25}
@keyframes kivotos-spin{to{transform:rotate(360deg)}}
.kivotos-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;box-sizing:border-box;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;white-space:nowrap;cursor:pointer}
.kivotos-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-btn:disabled{opacity:0.4;cursor:not-allowed}
.kivotos-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.kivotos-btn[data-size="sm"]{height:28px;padding:0 10px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}
.kivotos-btn[data-size="sm"] .kivotos-icon{width:14px;height:14px}
.kivotos-btn[data-kind="outline"]{border:0.5px solid var(--dsw-alias-border-l3)}
.kivotos-btn[data-kind="primary"]{min-width:96px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.kivotos-btn[data-kind="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill);opacity:0.9}
.kivotos-btn[data-kind="danger"]{color:var(--dsw-alias-state-error-primary)}
.kivotos-btn[data-kind="icon"]{width:28px;height:28px;padding:0;color:var(--dsw-alias-label-secondary)}
.kivotos-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:11px;font-weight:500;line-height:17px;white-space:nowrap}
.kivotos-tag[data-tone="success"]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.kivotos-tag[data-tone="warning"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}
.kivotos-tag[data-tone="danger"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}
.kivotos-link{display:grid;grid-template-columns:32px minmax(0,1fr) auto;column-gap:12px;align-items:center;padding:14px 16px}
.kivotos-link + .kivotos-link{border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-link-text{min-width:0}
.kivotos-link-head{display:flex;align-items:center;gap:8px;min-height:22px}
.kivotos-link-name{font-weight:500}
.kivotos-link-meta{display:flex;flex-wrap:wrap;column-gap:6px;margin:2px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.kivotos-actions{display:flex;align-items:center;gap:4px}
.kivotos-under{grid-column:2/-1;display:flex;flex-direction:column;gap:8px;min-width:0;margin-top:12px}
.kivotos-notice{display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:8px;margin:0;padding:8px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.kivotos-notice > .kivotos-icon{margin-top:2px;color:var(--dsw-alias-label-tertiary)}
.kivotos-notice b{font-weight:500;color:var(--dsw-alias-label-primary)}
.kivotos-notice[data-tone="warning"]{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 8%,transparent)}
.kivotos-notice[data-tone="warning"] > .kivotos-icon{color:var(--dsw-alias-state-warn-primary)}
.kivotos-notice[data-tone="danger"]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent)}
.kivotos-notice[data-tone="danger"] > .kivotos-icon{color:var(--dsw-alias-state-error-primary)}
.kivotos-notice-body{min-width:0;overflow-wrap:anywhere}
.kivotos-code{display:flex;align-items:center;gap:8px;margin-top:8px;padding:4px 4px 4px 10px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);min-width:0}
.kivotos-code code{flex:1;min-width:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,monospace);font-size:12px;line-height:18px;white-space:nowrap;text-overflow:ellipsis;user-select:all}
.kivotos-code[data-wrap] code{white-space:normal;word-break:break-all}
.kivotos-setup{display:grid;grid-template-columns:1fr 1fr;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-module-platform)}
.kivotos-setup-step{display:flex;flex-direction:column;gap:8px;min-width:0;margin:0;padding:14px 16px}
.kivotos-setup-step + .kivotos-setup-step{border-left:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-setup-title{font-size:13px;font-weight:500;line-height:20px}
.kivotos-form{display:flex;gap:8px;min-width:0}
.kivotos-input{flex:1;min-width:0;height:34px;box-sizing:border-box;padding:0 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.kivotos-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.kivotos-input:focus{outline:none;border-color:var(--dsw-alias-state-business-primary)}
.kivotos-form .kivotos-btn{height:34px}
.kivotos-mhead,.kivotos-mrow{display:grid;grid-template-columns:minmax(0,1fr) 104px 104px 108px;column-gap:12px;align-items:center}
.kivotos-mhead[data-links="1"],.kivotos-mrow[data-links="1"]{grid-template-columns:minmax(0,1fr) 120px}
.kivotos-mhead[data-links="0"],.kivotos-mrow[data-links="0"]{grid-template-columns:minmax(0,1fr)}
.kivotos-mhead{height:36px;padding:0 16px;border-bottom:0.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.kivotos-mhead > :first-child{padding-left:44px}
.kivotos-mrow{padding:10px 16px}
.kivotos-mrow + .kivotos-mrow{border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-mname{display:flex;align-items:center;gap:12px;min-width:0}
.kivotos-mname-text{display:flex;flex-direction:column;min-width:0}
.kivotos-mname-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kivotos-mname-os{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kivotos-cells{display:contents}
.kivotos-cell{position:relative;min-width:0}
.kivotos-cell-button{display:flex;flex-direction:column;align-items:flex-start;width:100%;min-width:0;margin:0;padding:0;border:none;background:transparent;color:inherit;font:inherit;text-align:left;cursor:default}
.kivotos-cell-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:var(--dsw-radius-sm)}
.kivotos-cell-label{display:none;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.kivotos-cell-state{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;white-space:nowrap}
.kivotos-cell[data-used] .kivotos-cell-state{color:var(--dsw-alias-label-primary);font-weight:600}
.kivotos-cell[data-state="none"] .kivotos-cell-state{color:var(--dsw-alias-label-tertiary)}
.kivotos-cell-qualifier{max-width:100%;padding-left:16px;box-sizing:border-box;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kivotos-dot{position:relative;flex:none;display:inline-block;width:10px;height:10px;color:var(--dsw-alias-state-idle-primary)}
.kivotos-dot::after{content:"";position:absolute;inset:20%;border-radius:50%;background:currentColor}
.kivotos-dot[data-state="online"]{color:var(--dsw-alias-state-success-primary)}
.kivotos-dot[data-state="unstable"]{color:var(--dsw-alias-state-warn-primary)}
.kivotos-dot[data-state="unreachable"],.kivotos-dot[data-state="denied"]{color:var(--dsw-alias-state-error-primary)}
.kivotos-dot[data-state="none"]{color:var(--dsw-alias-label-tertiary)}
.kivotos-dot[data-state="none"]::after{inset:45% 15%;border-radius:1px}
.kivotos-cell[data-used] .kivotos-dot::before{content:"";position:absolute;inset:-1px;border:2px solid color-mix(in srgb,currentColor 35%,transparent);border-radius:50%}
.kivotos-tip{position:absolute;top:calc(100% + 6px);left:0;z-index:40;display:none;box-sizing:border-box;width:max-content;max-width:360px;padding:3px 7px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-tooltip-bg);color:light-dark(var(--dsw-alias-label-primary-foreground),var(--dsw-alias-label-primary));font-size:13px;font-weight:400;line-height:20px;white-space:pre-line;overflow-wrap:break-word;pointer-events:none}
.kivotos-cell[data-open] .kivotos-tip{display:block}
@media (hover:hover){.kivotos-cell:hover .kivotos-tip,.kivotos-cell:has(:focus-visible) .kivotos-tip{display:block}}
.kivotos-mode{position:relative;min-width:0}
.kivotos-mode-trigger{justify-content:space-between;width:100%;padding:0 8px 0 10px}
.kivotos-mode-trigger .kivotos-icon{color:var(--dsw-alias-label-tertiary);transition:transform 120ms}
.kivotos-mode-trigger[aria-expanded="true"] .kivotos-icon{transform:rotate(180deg)}
.kivotos-mode-static{display:flex;align-items:center;height:28px;padding:0 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.kivotos-menu{position:absolute;top:calc(100% + 4px);right:0;z-index:40;display:flex;flex-direction:column;box-sizing:border-box;width:232px;margin:0;padding:4px;list-style:none;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent)}
.kivotos-menu-label{padding:6px 8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:15px}
.kivotos-menu-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;box-sizing:border-box;padding:6px 8px;border:none;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.kivotos-menu-item:hover:not(:disabled),.kivotos-menu-item:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}
.kivotos-menu-item:disabled{opacity:0.4;cursor:not-allowed}
.kivotos-menu-text{display:flex;flex:1;flex-direction:column;min-width:0}
.kivotos-menu-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.kivotos-menu-check{flex:none;width:14px;height:14px}
.kivotos-dialog{box-sizing:border-box;width:min(92vw,440px);max-height:90dvh;overflow:auto;margin:auto;padding:0 0 24px;border:none;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font:inherit;font-size:14px;line-height:22px}
.kivotos-dialog[open]{display:flex;flex-direction:column;gap:20px}
.kivotos-dialog[data-wide]{width:min(92vw,480px)}
.kivotos-dialog::backdrop{background:var(--dsw-alias-bg-mask-1)}
.kivotos-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 0 24px}
.kivotos-dialog-title{margin:0;font-size:16px;font-weight:500;line-height:24px}
.kivotos-dialog-desc{margin:0;padding:0 24px;color:var(--dsw-alias-label-secondary)}
.kivotos-dialog-body{display:flex;flex-direction:column;gap:16px;min-width:0;padding:0 24px}
.kivotos-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding:0 24px}
.kivotos-dialog-foot .kivotos-btn[data-kind="outline"]{min-width:72px}
.kivotos-invite{display:grid;grid-template-columns:152px minmax(0,1fr);column-gap:16px;align-items:center}
.kivotos-qr{display:block;box-sizing:border-box;width:152px;height:152px;padding:8px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:#fff}
.kivotos-pair-qr{display:block;box-sizing:border-box;width:min(100%,232px);height:auto;margin:0 auto;padding:10px;border-radius:var(--dsw-radius-md);background:#fff}
.kivotos-steps{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.kivotos-steps b{display:block;color:var(--dsw-alias-label-primary);font-weight:500}
.kivotos-field-label{margin:0 0 6px;font-size:13px;font-weight:500;line-height:20px}
.kivotos-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.kivotos-list li{display:grid;grid-template-columns:16px minmax(0,1fr);column-gap:8px;color:var(--dsw-alias-label-secondary)}
.kivotos-list li .kivotos-icon{margin-top:3px;color:var(--dsw-alias-label-tertiary)}
@container (max-width:520px){
.kivotos-link{grid-template-columns:32px minmax(0,1fr);row-gap:10px}
.kivotos-link > .kivotos-actions{grid-column:2/-1}
.kivotos-setup{grid-template-columns:1fr}
.kivotos-setup-step + .kivotos-setup-step{border-left:none;border-top:0.5px solid var(--dsw-alias-border-l2)}
.kivotos-mhead{display:none}
.kivotos-mrow,.kivotos-mrow[data-links="1"]{grid-template-columns:minmax(0,1fr) 108px;row-gap:8px}
.kivotos-mrow[data-links="0"]{grid-template-columns:minmax(0,1fr)}
.kivotos-mrow .kivotos-mname{grid-column:1;grid-row:1}
.kivotos-mrow .kivotos-mode-cell{grid-column:2;grid-row:1}
.kivotos-mrow .kivotos-cells{grid-column:1/-1;grid-row:2;display:grid;grid-template-columns:1fr 1fr;column-gap:12px;padding-left:44px}
.kivotos-cell-label{display:block}
.kivotos-invite{grid-template-columns:1fr;row-gap:16px;justify-items:center}
}
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
  /** relay-host.ts `RelayView`. */
  relay: {
    joined: boolean;
    relay?: string;
    registration?: string;
    invite?: string;
    /** The link is plaintext (`ws://`): the token crosses the network in the clear. */
    plaintext: boolean;
    state?: "connecting" | "online" | "denied" | "unreachable";
    error?: string | null;
    /** Why the relay is unreachable, when it can be told. */
    reason?: LinkReason;
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

/** The state a link cell shows: the link's own, `unstable`, or `none` when the machine lacks it. */
type CellState = MachineLink["state"] | "unstable" | "none";

/** A machine's cell on one link (DESIGN §3): dot, word, qualifier, and the tooltip lines. */
interface Cell {
  state: CellState;
  word: string;
  qualifier: string | null;
  /** Requests to the machine go through this link now. */
  used: boolean;
  tip: string;
}

/** @returns the short word for why a link does not work: its reason, else its state. */
function downText(t: Translate, down: LinkDown): string {
  if (down === "offline" || down === "denied" || down === "unreachable") return t(`state.${down}`);
  return t(`reason.${down}`);
}

/** Where a link reaches the machine, for the sentences that name it. */
function placeOf(link: MachineLink, host: string): Record<string, string> {
  return { address: link.address ?? host, host };
}

/**
 * @param host - this computer's relay host, for the sentences that name it.
 * @returns the cell of `machine` on `via`.
 */
function cellOf(t: Translate, machine: MachineInfo, via: Via, host: string, now: number): Cell {
  const linkName = t(`col.${via}`);
  const link = machine.links.find((candidate) => candidate.via === via);
  if (link === undefined) {
    const word = t("state.none");
    const head = t("tip.head", { link: linkName, word });
    const detail = t(`state.none-${via}.tip`, { name: machine.name });
    return { state: "none", word, qualifier: null, used: false, tip: `${head}\n${detail}` };
  }
  const used = machine.route === via;
  const place = placeOf(link, host);
  let state: CellState = link.state;
  let word = t(`state.${link.state}`);
  let qualifier: string | null = null;
  let detail: string | null = null;
  if (link.state === "online" && link.unstable === true) {
    state = "unstable";
    word = t("state.unstable");
    detail = t(
      pinnedVia(machine, machine.mode) === null
        ? "state.unstable.tip"
        : "state.unstable-pinned.tip",
    );
  } else if (link.state === "online") {
    detail = link.address ?? null;
  } else if (link.state === "offline") {
    if (link.lastSeen !== undefined) qualifier = agoText(t, link.lastSeen, now);
  } else if (link.state === "denied") {
    detail = t("state.denied.tip", place);
  } else if (link.reason !== undefined) {
    qualifier = t(`reason.${link.reason}`);
    detail = t(`reason.${link.reason}.tip`, place);
  }
  const lines = [t(used ? "tip.headUsed" : "tip.head", { link: linkName, word })];
  if (detail !== null) lines.push(detail);
  if (link.state !== "online" && link.lastSeen !== undefined)
    lines.push(t("tip.lastSeen", { ago: agoText(t, link.lastSeen, now) }));
  return { state, word, qualifier, used, tip: lines.join("\n") };
}

/** A machine in one word, and the colour of its dot. */
export interface MachineSummary {
  state: "online" | "unstable" | "offline" | "unreachable";
  text: string;
}

/**
 * @returns a machine's summary (the switcher's rows): the route in use, else
 *   unstable; with no route, why its preferred link (the one its mode holds
 *   it to, else the first) does not work, or when it was last seen.
 */
export function machineSummary(t: Translate, machine: MachineInfo, now: number): MachineSummary {
  const status = statusOf(machine, machine.mode);
  if (status.kind === "online") return { state: "online", text: t(`via.${status.via}`) };
  if (status.kind === "unstable") return { state: "unstable", text: t("state.unstable") };
  const pinned = pinnedVia(machine, machine.mode);
  const link = machine.links.find((candidate) => pinned === null || candidate.via === pinned);
  const down = link === undefined ? "offline" : (downOf(link) ?? "unreachable");
  if (down !== "offline") return { state: "unreachable", text: downText(t, down) };
  const lastSeen = link?.lastSeen ?? (status.kind === "offline" ? status.lastSeen : undefined);
  const text = lastSeen === undefined ? t("state.offline") : agoText(t, lastSeen, now);
  return { state: "offline", text };
}

/** @returns a machine in full (the switcher's tooltip): every link's tooltip, one after the other. */
export function machineTip(t: Translate, machine: MachineInfo, now: number): string {
  return machine.links
    .map((link) => cellOf(t, machine, link.via, link.address ?? "", now).tip)
    .join("\n");
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

/** Operating system names as people write them; `os` is Node's platform or the tailnet's OS. */
const OS_NAMES: Record<string, string> = {
  darwin: "macOS",
  macos: "macOS",
  linux: "Linux",
  win32: "Windows",
  windows: "Windows",
};

function osName(os: string): string {
  return OS_NAMES[os.toLowerCase()] ?? os;
}

/** Line icons on a 16-unit grid (original artwork, currentColor). */
const ICON = {
  chevron: "M4 6l4 4 4-4",
  check: "M3.5 8.5l3 3 6-7",
  close: "M4 4l8 8M12 4l-8 8",
  copy: "M5.5 5.5h7v7h-7zM3.5 10.5v-7h7",
  qr: "M2.5 2.5h4v4h-4zM9.5 2.5h4v4h-4zM2.5 9.5h4v4h-4zM9.5 9.5h1.5v1.5M13.5 9.5v1.5M9.5 13.5h2M13.5 12.5v1",
  invite:
    "M6.5 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2 13.5c.6-2.3 2.4-3.5 4.5-3.5s3.9 1.2 4.5 3.5M12.5 5v4M10.5 7h4",
  warning: "M8 2.5l6 10.5H2zM8 6.5v3M8 11.25v.25",
  info: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM8 7.5v3.5M8 5.25v.25",
  lock: "M4 7.5h8v6H4zM5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2",
  exit: "M6 2.5H3.5v11H6M10 5l3 3-3 3M13 8H6.5",
  tailscale: "M4 4h.01M8 4h.01M12 4h.01M4 8h.01M8 8h.01M12 8h.01M4 12h.01M8 12h.01M12 12h.01",
  relay: "M1.5 8h3M11.5 8h3M4.5 5.5h7v5h-7zM7 8h2",
  laptop: "M3.5 4.5h9v6h-9zM1.5 12.5h13",
  monitor: "M2 3.5h12v8H2zM6 14h4M8 11.5V14",
  server: "M2.5 2.5h11v4.5h-11zM2.5 9h11v4.5h-11zM5 4.75h.01M5 11.25h.01",
} as const;

function Icon({ name }: { name: keyof typeof ICON }): ReactNode {
  // The dot grids are round caps of near-zero strokes, drawn thicker.
  const bold = name === "tailscale" || name === "server";
  return (
    <svg className="kivotos-icon" viewBox="0 0 16 16" aria-hidden>
      <path d={ICON[name]} strokeWidth={bold ? 2 : undefined} />
    </svg>
  );
}

function Spinner(): ReactNode {
  return (
    <svg className="kivotos-spin" viewBox="0 0 10 10" aria-hidden>
      <circle cx="5" cy="5" r="3.6" />
      <circle cx="5" cy="5" r="3.6" strokeDasharray="6 30" />
    </svg>
  );
}

type Tone = "success" | "warning" | "danger" | "busy" | "neutral";

function Tag({ tone, text, title }: { tone: Tone; text: string; title?: string }): ReactNode {
  return (
    <span className="kivotos-tag" data-tone={tone} title={title}>
      {tone === "busy" ? <Spinner /> : null}
      {text}
    </span>
  );
}

/** A one-line notice: an icon, then **lead**: body; `children` go under the line. */
function Notice({
  tone,
  icon,
  lead,
  body,
  t,
  children,
}: {
  tone: "info" | "warning" | "danger";
  icon: keyof typeof ICON;
  lead: string;
  /** Absent for a notice that is its lead alone. */
  body?: string;
  t: Translate;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="kivotos-notice" data-tone={tone} role={tone === "danger" ? "alert" : "note"}>
      <Icon name={icon} />
      <div className="kivotos-notice-body">
        <b>{lead}</b>
        {body === undefined ? null : t("notice.sep") + body}
        {children}
      </div>
    </div>
  );
}

/** Text people copy out; the button appears only where the clipboard API exists. */
function Copyable({ text, wrap, t }: { text: string; wrap?: boolean; t: Translate }): ReactNode {
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
    <div className="kivotos-code" data-wrap={wrap === true ? "" : undefined}>
      <code title={text}>{text}</code>
      {canCopy ? (
        <button
          type="button"
          className="kivotos-btn"
          data-size="sm"
          data-kind="outline"
          onClick={copy}
        >
          <Icon name="copy" />
          {copied ? t("copied") : t("copy")}
        </button>
      ) : null}
    </div>
  );
}

/**
 * A modal on dsh's Modal geometry. A native modal keeps keyboard focus and
 * Escape inside the dialog, in the phone drawer and in the Settings panel alike.
 */
function Dialog({
  title,
  wide,
  t,
  onClose,
  children,
}: {
  title: string;
  wide?: boolean;
  t: Translate;
  onClose: () => void;
  /** The body, then a `kivotos-dialog-foot` with the buttons. */
  children: ReactNode;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    // React's autoFocus runs before the dialog opens, which moves focus again.
    node?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => node?.close();
  }, []);
  const dismiss = useCallback(() => dialog.current?.close(), []);
  // Escape closes this dialog only, not the Settings panel it was opened from.
  const onKey = useCallback((event: React.KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") event.stopPropagation();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="kivotos-dialog"
      data-wide={wide === true ? "" : undefined}
      aria-labelledby={titleId}
      onClose={onClose}
      onKeyDown={onKey}
    >
      <div className="kivotos-dialog-head">
        <h2 id={titleId} className="kivotos-dialog-title">
          {title}
        </h2>
        <button
          type="button"
          className="kivotos-btn"
          data-kind="icon"
          aria-label={t("close")}
          onClick={dismiss}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

/** Closes the dialog the button is in; its `close` event reaches the dialog's `onClose`. */
function closeDialog(event: React.MouseEvent<HTMLElement>): void {
  event.currentTarget.closest("dialog")?.close();
}

/** The pairing code, opened from the Tailscale row and the switcher. */
export function PairDialog({
  url,
  t,
  onClose,
}: {
  url: string;
  t: Translate;
  onClose: () => void;
}): ReactNode {
  const data = useMemo(() => `kivotos://pair?url=${encodeURIComponent(url)}`, [url]);
  return (
    <Dialog title={t("pair.title")} t={t} onClose={onClose}>
      <p className="kivotos-dialog-desc">{t("pair.instructions")}</p>
      <div className="kivotos-dialog-body">
        <QrImage data={data} label={t("pair.qr")} className="kivotos-pair-qr" />
        <div>
          <p className="kivotos-field-label">{t("pair.address")}</p>
          <Copyable text={url} wrap t={t} />
        </div>
      </div>
      <div className="kivotos-dialog-foot">
        <button
          type="button"
          className="kivotos-btn"
          data-kind="primary"
          data-autofocus=""
          onClick={closeDialog}
        >
          {t("pair.close")}
        </button>
      </div>
    </Dialog>
  );
}

/** The invite to the network: its QR code for a phone, its link for a computer. */
function InviteDialog({
  invite,
  t,
  onClose,
}: {
  invite: string;
  t: Translate;
  onClose: () => void;
}): ReactNode {
  return (
    <Dialog title={t("invite.title")} wide t={t} onClose={onClose}>
      <p className="kivotos-dialog-desc">{t("invite.desc")}</p>
      <div className="kivotos-dialog-body">
        <div className="kivotos-invite">
          <QrImage data={invite} label={t("invite.qr")} className="kivotos-qr" />
          <ul className="kivotos-steps">
            <li>
              <b>{t("invite.phone")}</b>
              {t("invite.phone.how")}
            </li>
            <li>
              <b>{t("invite.computer")}</b>
              {t("invite.computer.how")}
            </li>
          </ul>
        </div>
        <div>
          <p className="kivotos-field-label">{t("invite.link")}</p>
          <Copyable text={invite} wrap t={t} />
        </div>
      </div>
      <div className="kivotos-dialog-foot">
        <button
          type="button"
          className="kivotos-btn"
          data-kind="primary"
          data-autofocus=""
          onClick={closeDialog}
        >
          {t("done")}
        </button>
      </div>
    </Dialog>
  );
}

/** Leaving the network, confirmed: what goes with it, and what stays. */
function LeaveDialog({
  host,
  lost,
  act,
  busy,
  t,
  onClose,
}: {
  host: string;
  /** Machines this computer reaches only through the relay. */
  lost: readonly string[];
  act: LinksState["act"];
  busy: boolean;
  t: Translate;
  onClose: () => void;
}): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const leave = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const dialog = event.currentTarget.closest("dialog");
      setError(null);
      void (async () => {
        const failure = await act({ action: "leave" });
        if (failure === null) dialog?.close();
        else setError(failure);
      })();
    },
    [act],
  );
  return (
    <Dialog title={t("leave.title")} t={t} onClose={onClose}>
      <p className="kivotos-dialog-desc">{withCode(t, "leave.desc", "host", host)}</p>
      <div className="kivotos-dialog-body">
        <ul className="kivotos-list">
          {lost.length === 0 ? null : (
            <li>
              <Icon name="relay" />
              {t("leave.lose", { names: lost.join(t("leave.names")) })}
            </li>
          )}
          <li>
            <Icon name="exit" />
            {t("leave.others")}
          </li>
          <li>
            <Icon name="lock" />
            {t("leave.key")}
          </li>
          <li>
            <Icon name="check" />
            {t("leave.keep")}
          </li>
        </ul>
        {error === null ? null : (
          <Notice tone="danger" icon="warning" lead={t("leave.failed")} body={error} t={t} />
        )}
      </div>
      <div className="kivotos-dialog-foot">
        <button
          type="button"
          className="kivotos-btn"
          data-kind="outline"
          data-autofocus=""
          onClick={closeDialog}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          className="kivotos-btn"
          data-kind="primary"
          disabled={busy}
          onClick={leave}
        >
          {t("leave.confirm")}
        </button>
      </div>
    </Dialog>
  );
}

interface LinksState {
  links: Links | null;
  /** The machines this page's machine knows; null until read. */
  list: MachineList | null;
  /** The links could not be read. */
  failed: boolean;
  /** The machines could not be read. */
  listFailed: boolean;
  /** The last mode change failed. */
  modeError: string | null;
  busy: boolean;
  /** A relay action (index.ts `/kivotos/relay`); resolves to the refusal's message, or null. */
  act: (body: Record<string, string>) => Promise<string | null>;
  /** Set how this page's machine reaches one machine (index.ts `/kivotos/mode`). */
  changeMode: (id: string, mode: RouteMode) => void;
}

function useLinks(t: Translate): LinksState {
  const [links, setLinks] = useState<Links | null>(null);
  const [list, setList] = useState<MachineList | null>(null);
  const [failed, setFailed] = useState(false);
  const [listFailed, setListFailed] = useState(false);
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
        if (machines !== null) setList(machines);
        setListFailed(machines === null);
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

  const act = useCallback(async (body: Record<string, string>): Promise<string | null> => {
    setBusy(true);
    try {
      const response = await fetch(linksUrl("relay"), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      setLinks(await readBody<Links>(response));
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : String(cause);
    } finally {
      setBusy(false);
    }
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

  return { links, list, failed, listFailed, modeError, busy, act, changeMode };
}

/** @returns the text of `key` with its `param` set in the code font. */
function withCode(t: Translate, key: string, param: string, value: string): ReactNode {
  const mark = "\u0000";
  const [lead = "", after = ""] = t(key, { [param]: mark }).split(mark);
  return (
    <>
      {lead}
      <span className="kivotos-mono">{value}</span>
      {after}
    </>
  );
}

/** A row of the links card: its tile, then the text, actions and notices (`children`). */
function LinkRow({ icon, children }: { icon: keyof typeof ICON; children: ReactNode }): ReactNode {
  return (
    <li className="kivotos-link">
      <span className="kivotos-tile">
        <Icon name={icon} />
      </span>
      {children}
    </li>
  );
}

function Separator(): ReactNode {
  return <span aria-hidden>·</span>;
}

/**
 * Tailscale: whether this computer is on the tailnet, its listener address,
 * and its pairing code (not inside the phone app, which is what gets paired).
 */
function TailscaleRow({
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
  const { url, joined, name, listen } = links.tailscale;
  let tone: Tone = "success";
  let tag = "ts.tag.on";
  let facts: ReactNode;
  if (!joined) {
    tone = "danger";
    tag = "ts.tag.off";
    facts = t("ts.meta.off");
  } else if (!listen) {
    tone = "neutral";
    tag = "ts.tag.disabled";
    facts = t("ts.meta.disabled");
  } else if (url === null) {
    tone = "busy";
    tag = "ts.tag.starting";
    facts = t("ts.meta.starting");
  } else {
    facts = (
      <>
        <span>{t("ts.meta.device", { name })}</span>
        <Separator />
        <span>{withCode(t, "ts.meta.listen", "address", hostOf(url))}</span>
      </>
    );
  }
  return (
    <LinkRow icon="tailscale">
      <div className="kivotos-link-text">
        <div className="kivotos-link-head">
          <span className="kivotos-link-name">{t("ts.name")}</span>
          <Tag tone={tone} text={t(tag)} />
        </div>
        <p className="kivotos-link-meta">{facts}</p>
      </div>
      {inApp ? null : (
        <div className="kivotos-actions">
          <button
            ref={button}
            type="button"
            className="kivotos-btn"
            data-size="sm"
            data-kind="outline"
            disabled={url === null}
            title={url === null ? t("pair.unavailable") : undefined}
            onClick={pair}
          >
            <Icon name="qr" />
            {t("pair.action")}
          </button>
        </div>
      )}
      {pairing && url !== null ? <PairDialog url={url} t={t} onClose={closePair} /> : null}
    </LinkRow>
  );
}

/** Not in a network: join one by invite, or create it on a relay, side by side. */
function SetUp({
  act,
  busy,
  t,
}: {
  act: LinksState["act"];
  busy: boolean;
  t: Translate;
}): ReactNode {
  const [address, setAddress] = useState("");
  const [invite, setInvite] = useState("");
  const [failure, setFailure] = useState<{ lead: string; error: string } | null>(null);
  const onAddress = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setAddress(event.target.value),
    [],
  );
  const onInvite = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setInvite(event.target.value),
    [],
  );
  const run = useCallback(
    (body: Record<string, string>, lead: string) => {
      setFailure(null);
      void (async () => {
        const error = await act(body);
        if (error !== null) setFailure({ lead, error });
      })();
    },
    [act],
  );
  const join = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      run({ action: "join", invite: invite.trim() }, t("setup.joinFailed"));
    },
    [invite, run, t],
  );
  const create = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      run({ action: "create", relay: address.trim() }, t("setup.createFailed"));
    },
    [address, run, t],
  );
  const joinId = useId();
  const createId = useId();
  return (
    <>
      <div className="kivotos-setup">
        <form className="kivotos-setup-step" onSubmit={join}>
          <label className="kivotos-setup-title" htmlFor={joinId}>
            {t("setup.join.title")}
          </label>
          <div className="kivotos-form">
            <input
              id={joinId}
              className="kivotos-input"
              value={invite}
              onChange={onInvite}
              placeholder={t("setup.join.ph")}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="kivotos-btn"
              data-kind="outline"
              disabled={busy || invite.trim() === ""}
            >
              {t("setup.join.btn")}
            </button>
          </div>
        </form>
        <form className="kivotos-setup-step" onSubmit={create}>
          <label className="kivotos-setup-title" htmlFor={createId}>
            {t("setup.create.title")}
          </label>
          <div className="kivotos-form">
            <input
              id={createId}
              className="kivotos-input"
              value={address}
              onChange={onAddress}
              placeholder={t("setup.create.ph")}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="kivotos-btn"
              data-kind="outline"
              disabled={busy || address.trim() === ""}
            >
              {t("setup.create.btn")}
            </button>
          </div>
        </form>
      </div>
      {failure === null ? null : (
        <Notice tone="danger" icon="warning" lead={failure.lead} body={failure.error} t={t} />
      )}
    </>
  );
}

/** The relay link's tag: its state, with the reason in the tooltip when it is down. */
function relayTag(t: Translate, relay: Links["relay"], host: string): ReactNode {
  switch (relay.state ?? "connecting") {
    case "online":
      return <Tag tone="success" text={t("relay.tag.on")} />;
    case "connecting":
      return <Tag tone="busy" text={t("relay.tag.connecting")} />;
    case "denied":
      return <Tag tone="warning" text={t("relay.tag.denied")} />;
    case "unreachable":
      return (
        <Tag
          tone="danger"
          text={t("relay.tag.unreachable")}
          title={t(`reason.${relay.reason ?? "relay-unreachable"}.tip`, { host, address: host })}
        />
      );
  }
}

/**
 * Own relay: in a network, its state, host and machines online, with Invite
 * and Leave and the notices that apply now; not in one, the set-up steps.
 */
function RelayRow({
  links,
  state,
  t,
}: {
  links: Links;
  state: LinksState;
  t: Translate;
}): ReactNode {
  const [dialog, setDialog] = useState<"invite" | "leave" | null>(null);
  const inviteButton = useRef<HTMLButtonElement | null>(null);
  const leaveButton = useRef<HTMLButtonElement | null>(null);
  const invite = useCallback(() => setDialog("invite"), []);
  const leave = useCallback(() => setDialog("leave"), []);
  const closed = useCallback(() => {
    (dialog === "invite" ? inviteButton : leaveButton).current?.focus();
    setDialog(null);
  }, [dialog]);
  const { relay } = links;
  // Leaving ends the row's network, and with it any dialog about it.
  useEffect(() => {
    if (!relay.joined) setDialog(null);
  }, [relay.joined]);
  const { act, busy, list } = state;
  const lost = useMemo(
    () =>
      (list?.machines ?? [])
        .filter((machine) => machine.links.every((link) => link.via === "relay"))
        .map((machine) => machine.name),
    [list],
  );
  if (!relay.joined) {
    return (
      <LinkRow icon="relay">
        <div className="kivotos-link-text">
          <div className="kivotos-link-head">
            <span className="kivotos-link-name">{t("relay.name")}</span>
            <Tag tone="neutral" text={t("relay.tag.none")} />
          </div>
        </div>
        <div className="kivotos-under">
          <SetUp act={act} busy={busy} t={t} />
        </div>
      </LinkRow>
    );
  }
  const host = hostOf(relay.relay ?? "");
  const status = relay.state ?? "connecting";
  const register = status === "denied" && relay.registration !== undefined;
  const reset = status === "unreachable" && relay.reason === "tls-reset";
  return (
    <LinkRow icon="relay">
      <div className="kivotos-link-text">
        <div className="kivotos-link-head">
          <span className="kivotos-link-name">{t("relay.name")}</span>
          {relayTag(t, relay, host)}
        </div>
        <p className="kivotos-link-meta">
          <span className="kivotos-mono">{host}</span>
          {status === "online" ? (
            <>
              <Separator />
              <span>{t("relay.meta.online", { count: relay.peers })}</span>
            </>
          ) : null}
        </p>
      </div>
      <div className="kivotos-actions">
        <button
          ref={inviteButton}
          type="button"
          className="kivotos-btn"
          data-size="sm"
          data-kind="outline"
          disabled={relay.invite === undefined}
          onClick={invite}
        >
          <Icon name="invite" />
          {t("relay.invite")}
        </button>
        <button
          ref={leaveButton}
          type="button"
          className="kivotos-btn"
          data-size="sm"
          data-kind="danger"
          onClick={leave}
        >
          {t("relay.leave")}
        </button>
      </div>
      {register || reset || relay.plaintext ? (
        <div className="kivotos-under">
          {register ? (
            <Notice
              tone="warning"
              icon="warning"
              lead={t("notice.register.lead")}
              body={t("notice.register.body")}
              t={t}
            >
              <Copyable text={`kivotos-relay network add ${relay.registration}`} t={t} />
            </Notice>
          ) : null}
          {reset ? (
            <Notice
              tone="info"
              icon="info"
              lead={t("notice.reset.lead")}
              body={t("notice.reset.body")}
              t={t}
            />
          ) : null}
          {relay.plaintext ? (
            <Notice
              tone="warning"
              icon="lock"
              lead={t("notice.plain.lead")}
              body={t("notice.plain.body")}
              t={t}
            />
          ) : null}
        </div>
      ) : null}
      {dialog === "invite" && relay.invite !== undefined ? (
        <InviteDialog invite={relay.invite} t={t} onClose={closed} />
      ) : null}
      {dialog === "leave" ? (
        <LeaveDialog host={host} lost={lost} act={act} busy={busy} t={t} onClose={closed} />
      ) : null}
    </LinkRow>
  );
}

/**
 * A machine's state on one link: dot, word, qualifier. The full text is its
 * `title` and accessible name, a tooltip on hover or focus, and a popover a
 * tap toggles, where there is no hover.
 */
function LinkCell({ cell, label }: { cell: Cell; label: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  // Escape closes the popover only, not the Settings panel around it.
  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!open || event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    },
    [open],
  );
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);
  return (
    <div
      ref={root}
      onKeyDown={onKey}
      className="kivotos-cell"
      data-state={cell.state}
      data-used={cell.used ? "" : undefined}
      data-open={open ? "" : undefined}
    >
      <button
        type="button"
        className="kivotos-cell-button"
        title={cell.tip}
        aria-label={cell.tip}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="kivotos-cell-label" aria-hidden>
          {label}
        </span>
        <span className="kivotos-cell-state" aria-hidden>
          <span className="kivotos-dot" data-state={cell.state} />
          {cell.word}
        </span>
        {cell.qualifier === null ? null : (
          <span className="kivotos-cell-qualifier" aria-hidden>
            {cell.qualifier}
          </span>
        )}
      </button>
      <span className="kivotos-tip" aria-hidden>
        {cell.tip}
      </span>
    </div>
  );
}

/**
 * How a machine reached both ways is reached, as a dropdown: Auto and each
 * link, a link that is down disabled with why unless it is the choice
 * (machines.ts `modeOptions`), so the control never changes shape.
 */
function ModeMenu({
  machine,
  options,
  t,
  onChange,
}: {
  machine: MachineInfo;
  options: readonly ModeOption[];
  t: Translate;
  onChange: (id: string, mode: RouteMode) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  const toggle = useCallback(() => setOpen((shown) => !shown), []);
  const choose = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const mode = event.currentTarget.dataset.mode;
      setOpen(false);
      trigger.current?.focus();
      if (isRouteMode(mode) && mode !== machine.mode) onChange(machine.id, mode);
    },
    [machine.id, machine.mode, onChange],
  );
  // Escape closes the menu only, not the Settings panel around it.
  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!open) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const items = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>(".kivotos-menu-item:enabled") ?? []),
      ];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    },
    [open],
  );
  useEffect(() => {
    if (!open) return undefined;
    root.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const onPointer = (event: PointerEvent): void => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    return () => document.removeEventListener("pointerdown", onPointer, true);
  }, [open]);
  const label = t("mode.menu.label", { name: machine.name });
  return (
    <div ref={root} className="kivotos-mode" onKeyDown={onKey}>
      <button
        ref={trigger}
        type="button"
        className="kivotos-btn kivotos-mode-trigger"
        data-size="sm"
        data-kind="outline"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${t(`mode.${machine.mode}`)}`}
        onClick={toggle}
      >
        {t(`mode.${machine.mode}`)}
        <Icon name="chevron" />
      </button>
      {open ? (
        <div id={menuId} className="kivotos-menu" role="menu" aria-label={label}>
          <div className="kivotos-menu-label" aria-hidden>
            {label}
          </div>
          {options.map((option) => {
            const checked = option.mode === machine.mode;
            const down = option.disabled;
            return (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                className="kivotos-menu-item"
                aria-checked={checked}
                disabled={down !== undefined && !checked}
                data-mode={option.mode}
                onClick={choose}
              >
                <span className="kivotos-menu-text">
                  <span>{t(`mode.${option.mode}`)}</span>
                  <span className="kivotos-menu-desc">
                    {down === undefined
                      ? t(`mode.${option.mode}.desc`)
                      : t("mode.unavailable", { reason: downText(t, down) })}
                  </span>
                </span>
                {checked ? (
                  <svg className="kivotos-icon kivotos-menu-check" viewBox="0 0 16 16" aria-hidden>
                    <path d={ICON.check} />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The tile glyph of a machine: a server for Linux, a laptop for a notebook, else a monitor. */
function machineIcon(machine: MachineInfo): keyof typeof ICON {
  if (osName(machine.os) === "Linux") return "server";
  return /book|laptop/i.test(machine.name) ? "laptop" : "monitor";
}

interface MachineRowProps {
  machine: MachineInfo;
  /** The links this computer has: one cell each. */
  vias: readonly Via[];
  /** This computer's relay host, for the sentences that name it. */
  host: string;
  now: number;
  t: Translate;
  onChange: (id: string, mode: RouteMode) => void;
}

/** One machine: name and OS, a cell per link this computer has, and its mode. */
function MachineRow({ machine, vias, host, now, t, onChange }: MachineRowProps): ReactNode {
  const options = useMemo(() => modeOptions(machine), [machine]);
  return (
    <li className="kivotos-mrow" data-links={vias.length}>
      <div className="kivotos-mname">
        <span className="kivotos-tile">
          <Icon name={machineIcon(machine)} />
        </span>
        <span className="kivotos-mname-text">
          <span className="kivotos-mname-name">{machine.name}</span>
          {machine.os === "" ? null : (
            <span className="kivotos-mname-os">{osName(machine.os)}</span>
          )}
        </span>
      </div>
      {vias.length === 0 ? null : (
        <div className="kivotos-cells">
          {vias.map((via) => (
            <LinkCell key={via} cell={cellOf(t, machine, via, host, now)} label={t(`col.${via}`)} />
          ))}
        </div>
      )}
      {vias.length < 2 ? null : (
        <div className="kivotos-mode-cell">
          {options.length === 0 ? (
            <span className="kivotos-mode-static">{t("mode.only")}</span>
          ) : (
            <ModeMenu machine={machine} options={options} t={t} onChange={onChange} />
          )}
        </div>
      )}
    </li>
  );
}

function MachinesGroup({
  state,
  vias,
  host,
  t,
}: {
  state: LinksState;
  vias: readonly Via[];
  host: string;
  t: Translate;
}): ReactNode {
  const { list, changeMode } = state;
  const headingId = useId();
  // Re-rendered on every poll, which also moves "last seen" along.
  const now = Date.now();
  let body: ReactNode;
  if (list === null && state.listFailed)
    body = <Notice tone="danger" icon="warning" lead={t("settings.failed")} t={t} />;
  else if (list === null)
    body = (
      <p className="kivotos-text">
        <Spinner />
        {t("settings.loading")}
      </p>
    );
  else if (list.machines.length === 0) body = <p className="kivotos-text">{t("machines.none")}</p>;
  else {
    body = (
      <div className="kivotos-card">
        <div className="kivotos-mhead" data-links={vias.length} aria-hidden>
          <span>{t("col.machine")}</span>
          {vias.map((via) => (
            <span key={via}>{t(`col.${via}`)}</span>
          ))}
          {vias.length < 2 ? null : <span>{t("col.mode")}</span>}
        </div>
        <ul className="kivotos-card-list" aria-labelledby={headingId}>
          {list.machines.map((machine) => (
            <MachineRow
              key={machine.id}
              machine={machine}
              vias={vias}
              host={host}
              now={now}
              t={t}
              onChange={changeMode}
            />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <section className="kivotos-group">
      <div className="kivotos-group-head">
        <h3 id={headingId} className="kivotos-group-label">
          {t("machines.label")}
        </h3>
        {list === null || list.machines.length === 0 ? null : (
          <span className="kivotos-group-count">
            {t("machines.count", { count: list.machines.length })}
          </span>
        )}
      </div>
      {body}
      {state.modeError === null ? null : (
        <Notice tone="danger" icon="warning" lead={state.modeError} t={t} />
      )}
    </section>
  );
}

const NO_VIAS: readonly Via[] = [];
const TAILSCALE: readonly Via[] = ["tailscale"];
const RELAY: readonly Via[] = ["relay"];
const BOTH: readonly Via[] = ["tailscale", "relay"];

/**
 * The section body: this computer's links, then the machines it knows.
 * @param inApp - the page runs in the Kivotos phone app (client.tsx IN_APP).
 */
export function LinksSection({ t, inApp }: { t: Translate; inApp: boolean }): ReactNode {
  const state = useLinks(t);
  const headingId = useId();
  const { links } = state;
  if (links === null) {
    return (
      <div className="kivotos-links">
        <h2 className="kivotos-title">{t("settings.nav")}</h2>
        {state.failed ? (
          <Notice tone="danger" icon="warning" lead={t("settings.failed")} t={t} />
        ) : (
          <p className="kivotos-text">
            <Spinner />
            {t("settings.loading")}
          </p>
        )}
      </div>
    );
  }
  // A machine gets a cell for each link this computer has, and none for the others.
  let vias = NO_VIAS;
  if (links.tailscale.joined) vias = links.relay.joined ? BOTH : TAILSCALE;
  else if (links.relay.joined) vias = RELAY;
  return (
    <div className="kivotos-links">
      <h2 className="kivotos-title">{t("settings.nav")}</h2>
      <section className="kivotos-group">
        <h3 id={headingId} className="kivotos-group-label">
          {t("links.label")}
        </h3>
        <ul className="kivotos-card" aria-labelledby={headingId}>
          <TailscaleRow links={links} inApp={inApp} t={t} />
          <RelayRow links={links} state={state} t={t} />
        </ul>
      </section>
      <MachinesGroup state={state} vias={vias} host={hostOf(links.relay.relay ?? "")} t={t} />
    </div>
  );
}
