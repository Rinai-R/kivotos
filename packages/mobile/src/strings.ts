/** UI strings of the app's own screens (everything else is dsh's UI). */
import { zh } from "./machines";

const en = {
  title: "Machines",
  empty:
    "Add the computers running dsh with Kivotos. Use the address shown in Tailscale, for example 100.64.0.1.",
  addPlaceholder: "Tailscale IP or name, e.g. 100.64.0.1",
  add: "Add",
  adding: "Connecting…",
  remove: "Remove",
  removeConfirm: "Remove {name}?",
  cancel: "Cancel",
  errorForbidden:
    "This machine refused the phone. Sign the phone in to the same Tailscale account.",
  errorNotKivotos: "Something answered, but it is not Kivotos. Check the port (default 7380).",
  errorUnreachable:
    "Cannot reach this address. Check that Tailscale is on and the machine runs dsh with Kivotos.",
  errorInvalid: "Not a valid address.",
  duplicate: "This machine is already in the list.",
  notifications: "Notifications",
  notificationsOn: "On — approvals, questions and finished tasks",
  notificationsOff: "Off",
  notificationsDenied: "Blocked in Android settings",
  batteryHint:
    "Android may stop notifications to save battery. Allow Kivotos to run in the background.",
  batteryFix: "Allow",
  back: "Machines",
  offline: "Cannot load this machine. Pull down to retry.",
};

const zhText: typeof en = {
  title: "机器",
  empty: "添加运行了 dsh 和 Kivotos 的电脑，使用 Tailscale 里显示的地址，例如 100.64.0.1。",
  addPlaceholder: "Tailscale IP 或名称，例如 100.64.0.1",
  add: "添加",
  adding: "连接中…",
  remove: "移除",
  removeConfirm: "移除 {name}？",
  cancel: "取消",
  errorForbidden: "这台机器拒绝了手机。请让手机登录同一个 Tailscale 账号。",
  errorNotKivotos: "该地址有响应，但不是 Kivotos。请检查端口（默认 7380）。",
  errorUnreachable: "无法连接。请确认 Tailscale 已开启，且这台机器运行着装了 Kivotos 的 dsh。",
  errorInvalid: "地址格式不对。",
  duplicate: "这台机器已经在列表里了。",
  notifications: "通知",
  notificationsOn: "已开启：审批、提问、任务完成",
  notificationsOff: "已关闭",
  notificationsDenied: "已在系统设置中被禁止",
  batteryHint: "安卓可能为省电而停止通知。请允许 Kivotos 在后台运行。",
  batteryFix: "允许",
  back: "机器",
  offline: "无法加载这台机器，下拉重试。",
};

export type Key = keyof typeof en;

export function t(key: Key, params: Record<string, string> = {}): string {
  const template = (zh ? zhText : en)[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}
