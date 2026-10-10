/** UI strings of the app's own screens (everything else is dsh's UI). */
import { zh } from "./machines";

const en = {
  tagline: "Every dsh on your tailnet, in your pocket",
  sectionMachines: "Machines",
  sectionSettings: "Settings",
  emptyTitle: "Connect your first computer",
  emptyStep1:
    "On the computer, open Machines at the bottom of the dsh sidebar and choose Pair phone.",
  emptyStep2: "Tap Scan to pair below and point the camera at the code.",
  scan: "Scan to pair",
  scanHint: "Point the camera at the QR code Kivotos shows on your computer",
  manual: "Enter address manually",
  manualShort: "Type address",
  manualHint: "Use the computer's Tailscale IP, not the phone's.",
  addPlaceholder: "100.64.0.1",
  add: "Add",
  adding: "Connecting…",
  removeHint: "Long-press a machine to remove it",
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
  tagline: "随身使用 tailnet 上的每一个 dsh",
  sectionMachines: "机器",
  sectionSettings: "设置",
  emptyTitle: "连接第一台电脑",
  emptyStep1: "在电脑的 dsh 中，打开侧边栏底部的「机器」，选择「配对手机」。",
  emptyStep2: "点下方「扫码配对」，对准电脑上的二维码。",
  scan: "扫码配对",
  scanHint: "对准电脑上 Kivotos 显示的二维码",
  manual: "手动输入地址",
  manualShort: "手动输入",
  manualHint: "填写电脑的 Tailscale IP，不是手机的。",
  addPlaceholder: "100.64.0.1",
  add: "添加",
  adding: "连接中…",
  removeHint: "长按机器可移除",
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

/** The message for a failed `hello()` check. */
export function errorKey(error: unknown): Key {
  const message = error instanceof Error ? error.message : "";
  if (message === "forbidden") return "errorForbidden";
  if (message === "not-kivotos") return "errorNotKivotos";
  return "errorUnreachable";
}
