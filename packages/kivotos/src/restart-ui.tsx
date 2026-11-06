/**
 * Safe restart, client side: the switcher's "Restart dsh" entry, its
 * confirmation, the "restarting" overlay that reconnects by itself, and the
 * "back online" notice after it.
 *
 * Everything goes to the machine the page is served from: `/kivotos/restart`
 * on its own page, `/kivotos/peer/<id>/kivotos/restart` on a mounted peer's.
 * Whatever link carried the page (the tailnet listener, a relay session, the
 * phone app's door with its fallback) carries the polls too.
 */
import * as React from "react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RestartStatus, VersionChange } from "./restart-core.ts";
import { closeDialog, Dialog, type Translate } from "./settings.tsx";

export const RESTART_ZH = {
  "restart.action": "重启 dsh…",
  "restart.title": "重启 {name} 上的 dsh",
  "restart.desc": "dsh 会正常退出再自动启动，加载已安装的插件更新。断开期间页面会自动重连。",
  "restart.loading": "正在检查运行中的任务…",
  "restart.idle": "当前没有运行中的任务。",
  "restart.busy": "以下任务正在运行，立即重启会中断它们：",
  "restart.session": "会话：{title}",
  "restart.job": "后台任务：{label}",
  "restart.reminders": "有已设定的定时提醒；重启后需要重新打开对应会话。",
  "restart.confirmOnScreen":
    "桌面端会在屏幕上弹出退出确认，远程无法点击；Kivotos 会在 15 秒后强制关闭窗口进程（Host 仍会正常关闭并写完会话日志）。",
  "restart.unsupported": "无法安全重启：{reason}",
  "restart.now": "立即重启",
  "restart.whenIdle": "空闲时重启",
  "restart.cancel": "取消",
  "restart.close": "关闭",
  "restart.failedRequest": "未能开始重启：{error}",
  "restart.waiting": "等待任务结束后重启 dsh…",
  "restart.waitingCancel": "取消重启",
  "restart.restarting": "正在重启 {name} 上的 dsh…",
  "restart.reconnecting": "正在重连（已等待 {seconds} 秒）",
  "restart.slow": "dsh 还没有回来。Kivotos 会继续重试；那台机器上的日志：{log}",
  "restart.failed": "重启失败：{error}。日志：{log}",
  "restart.back": "dsh 已恢复在线 · {version}",
  "restart.backChanged": "更新：{changes}",
  "restart.backNoChange": "插件没有变化",
  "restart.dismiss": "知道了",
};

export const RESTART_EN: Record<keyof typeof RESTART_ZH, string> = {
  "restart.action": "Restart dsh…",
  "restart.title": "Restart dsh on {name}",
  "restart.desc":
    "dsh quits cleanly and starts again by itself, loading installed plugin updates. This page reconnects on its own.",
  "restart.loading": "Checking for running tasks…",
  "restart.idle": "Nothing is running.",
  "restart.busy": "These are running; restarting now interrupts them:",
  "restart.session": "Session: {title}",
  "restart.job": "Job: {label}",
  "restart.reminders": "Scheduled reminders are armed; reopen their sessions after the restart.",
  "restart.confirmOnScreen":
    "The desktop app will ask for confirmation on its screen, which nobody can answer remotely; Kivotos force-closes the window process after 15 s (the Host still shuts down cleanly and finishes its session logs).",
  "restart.unsupported": "Cannot restart safely: {reason}",
  "restart.now": "Restart now",
  "restart.whenIdle": "Restart when idle",
  "restart.cancel": "Cancel",
  "restart.close": "Close",
  "restart.failedRequest": "Could not start the restart: {error}",
  "restart.waiting": "dsh restarts once the running tasks finish…",
  "restart.waitingCancel": "Cancel restart",
  "restart.restarting": "Restarting dsh on {name}…",
  "restart.reconnecting": "Reconnecting ({seconds} s so far)",
  "restart.slow": "dsh is not back yet. Kivotos keeps trying; the log on that machine: {log}",
  "restart.failed": "The restart failed: {error}. Log: {log}",
  "restart.back": "dsh is back online · {version}",
  "restart.backChanged": "Updated: {changes}",
  "restart.backNoChange": "No plugin changed",
  "restart.dismiss": "Dismiss",
};

export const RESTART_CSS = `
.kivotos-restart-list{margin:0;padding:0 24px 0 42px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.kivotos-restart-note{margin:0;padding:0 24px;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.kivotos-restart-note[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary)}
.kivotos-restart-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.kivotos-restart-foot{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;padding:0 24px}
.kivotos-restart-cover{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;background:var(--dsw-alias-bg-mask-1)}
.kivotos-restart-card{box-sizing:border-box;width:min(92vw,400px);padding:24px;border-radius:var(--dsw-radius-panel);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font-size:14px;line-height:22px;text-align:center}
.kivotos-restart-card p{margin:8px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.kivotos-restart-spin{width:22px;height:22px;margin:0 auto 12px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-label-primary);border-radius:50%;animation:kivotos-restart-spin 900ms linear infinite}
@keyframes kivotos-restart-spin{to{transform:rotate(360deg)}}
.kivotos-restart-banner{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:1100;display:flex;align-items:center;gap:10px;box-sizing:border-box;max-width:calc(100vw - 32px);padding:10px 14px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);font-size:13px;line-height:20px;box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%)}
.kivotos-restart-banner button{padding:0;border:0;background:none;color:var(--dsw-alias-link);font:inherit;cursor:pointer;white-space:nowrap}
.kivotos-restart-toast{position:fixed;top:calc(40px + env(safe-area-inset-top,0px));left:50%;z-index:1100;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;max-width:min(560px,calc(100vw - 32px));padding:12px 16px;border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-toast-bg);color:var(--dsw-alias-toast-label);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3);transform:translateX(-50%)}
.kivotos-restart-toast small{opacity:.8;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.kivotos-restart-toast button{align-self:flex-end;padding:0;border:0;background:none;color:var(--dsw-alias-link);font:inherit;font-size:13px;cursor:pointer}
@media (prefers-reduced-motion:reduce){.kivotos-restart-spin{animation:none}}
`;

/** @returns where the page's own machine answers `/kivotos/restart`. */
export function restartUrl(peer: string | null): string {
  return peer === null
    ? "/kivotos/restart"
    : `/kivotos/peer/${encodeURIComponent(peer)}/kivotos/restart`;
}

/** The reconnect schedule: 1, 2, 3, 5 s, then every 5 s. */
export function backoffMs(attempt: number): number {
  return [1_000, 2_000, 3_000][attempt] ?? 5_000;
}

/** @returns the changes as one line, `kivotos 0.3.1 → 0.4.0, …`. */
export function changesText(changes: readonly VersionChange[]): string {
  return changes.map((c) => `${c.name} ${c.from ?? "–"} → ${c.to ?? "–"}`).join(", ");
}

async function getStatus(url: string, signal?: AbortSignal): Promise<RestartStatus> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as RestartStatus;
}

/** A restart this page started, which outlives the dialog (and the switcher on a phone). */
interface Watch {
  url: string;
  name: string;
  /** The Host process before the restart: a different one answering means it is back. */
  pid: number;
  phase: "waiting" | "restarting";
  since: number;
  log?: string;
  error?: string;
}

let watch: Watch | null = null;
const listeners = new Set<() => void>();
function setWatch(next: Watch | null): void {
  watch = next;
  for (const listener of listeners) listener();
}
function useWatch(): Watch | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => watch,
  );
}

const SEEN_KEY = "kivotos:restart-seen";
/** How long after coming back the notice is still news. */
const NEWS_MS = 30 * 60_000;

/** The confirmation: what is running, and how to restart. */
export function RestartDialog({
  peer,
  name,
  t,
  onClose,
}: {
  peer: string | null;
  name: string;
  t: Translate;
  onClose: () => void;
}): ReactNode {
  const url = restartUrl(peer);
  const [status, setStatus] = useState<RestartStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    getStatus(url, abort.signal)
      .then(setStatus)
      .catch((reason: unknown) => {
        if (!abort.signal.aborted)
          setError(String(reason instanceof Error ? reason.message : reason));
      });
    return () => abort.abort();
  }, [url]);
  const send = useCallback(
    async (mode: "now" | "idle", event: React.MouseEvent<HTMLElement>) => {
      const dialog = event.currentTarget.closest("dialog");
      setSending(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const body = (await res.json()) as RestartStatus | { error: string };
        if (!res.ok || "error" in body) {
          setError("error" in body ? body.error : String(res.status));
          setSending(false);
          return;
        }
        setWatch({
          url,
          name,
          pid: body.pid,
          phase: body.pending?.phase === "waiting" ? "waiting" : "restarting",
          since: Date.now(),
          log: body.log,
        });
        dialog?.close();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        setSending(false);
      }
    },
    [url, name],
  );
  const now = useCallback(
    (event: React.MouseEvent<HTMLElement>) => void send("now", event),
    [send],
  );
  const idle = useCallback(
    (event: React.MouseEvent<HTMLElement>) => void send("idle", event),
    [send],
  );
  const busy = status === null ? 0 : status.busy.sessions.length + status.busy.jobs.length;
  return (
    <Dialog title={t("restart.title", { name })} t={t} onClose={onClose}>
      <p className="kivotos-dialog-desc">{t("restart.desc")}</p>
      {status === null && error === null ? (
        <p className="kivotos-restart-note">{t("restart.loading")}</p>
      ) : null}
      {status === null ? null : <RestartFacts status={status} t={t} />}
      {error !== null ? (
        <p className="kivotos-restart-note" data-tone="error">
          {t("restart.failedRequest", { error })}
        </p>
      ) : null}
      <div className="kivotos-restart-foot">
        <button type="button" className="kivotos-btn" data-autofocus="" onClick={closeDialog}>
          {status !== null && !status.supported ? t("restart.close") : t("restart.cancel")}
        </button>
        {status !== null && status.supported ? (
          <>
            {busy > 0 ? (
              <button
                type="button"
                className="kivotos-btn"
                data-kind="primary"
                disabled={sending}
                onClick={idle}
              >
                {t("restart.whenIdle")}
              </button>
            ) : null}
            <button
              type="button"
              className="kivotos-btn"
              data-kind={busy > 0 ? "danger" : "primary"}
              disabled={sending}
              onClick={now}
            >
              {t("restart.now")}
            </button>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}

/** What the dialog says about the machine: why it cannot restart, or what runs. */
function RestartFacts({ status, t }: { status: RestartStatus; t: Translate }): ReactNode {
  const busy = status.busy.sessions.length + status.busy.jobs.length;
  if (!status.supported) {
    return (
      <p className="kivotos-restart-note" data-tone="error">
        {t("restart.unsupported", { reason: status.reason ?? "" })}
      </p>
    );
  }
  return (
    <>
      {busy === 0 ? <p className="kivotos-restart-note">{t("restart.idle")}</p> : null}
      {busy > 0 ? (
        <>
          <p className="kivotos-restart-note">{t("restart.busy")}</p>
          <ul className="kivotos-restart-list">
            {status.busy.sessions.map((session) => (
              <li key={session.id}>
                {t("restart.session", { title: session.title ?? session.id })}
              </li>
            ))}
            {status.busy.jobs.map((job) => (
              <li key={job.id}>{t("restart.job", { label: job.label })}</li>
            ))}
          </ul>
        </>
      ) : null}
      {status.busy.reminders ? (
        <p className="kivotos-restart-note">{t("restart.reminders")}</p>
      ) : null}
      {status.confirmOnScreen ? (
        <p className="kivotos-restart-note" data-tone="warn">
          {t("restart.confirmOnScreen")}
        </p>
      ) : null}
    </>
  );
}

/** Poll the restarting machine until another Host answers, then reload into it. */
function useReconnect(current: Watch | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (current === null) return undefined;
    let stopped = false;
    let attempt = 0;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const status = await getStatus(current.url);
        if (stopped) return;
        if (status.pid !== current.pid) {
          // Back: a new Host. The reload boots dsh's page against it.
          window.location.reload();
          return;
        }
        if (current.phase === "waiting" && status.pending?.phase !== "waiting") {
          if (status.pending === null && status.last?.phase === "failed") {
            setWatch({ ...current, error: status.last.error ?? "", log: status.last.log });
            return;
          }
          if (status.pending === null) {
            setWatch(null);
            return;
          }
          setWatch({ ...current, phase: "restarting" });
          return;
        }
        attempt = 0;
      } catch {
        // Down, as expected while it restarts: keep trying.
        attempt++;
      }
      if (!stopped) {
        setTick((value) => value + 1);
        timer = window.setTimeout(() => void poll(), backoffMs(attempt));
      }
    };
    timer = window.setTimeout(() => void poll(), backoffMs(0));
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [current]);
  return tick;
}

/** The restart's own overlay: a banner while waiting for idle, a cover while restarting. */
export function RestartOverlay({ t }: { t: Translate }): ReactNode {
  const current = useWatch();
  useReconnect(current);
  const cancel = useCallback(() => {
    if (current === null) return;
    void fetch(current.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    }).finally(() => setWatch(null));
  }, [current]);
  const dismiss = useCallback(() => setWatch(null), []);
  if (current === null) return null;
  if (current.phase === "waiting" && current.error === undefined) {
    return createPortal(
      <>
        <style>{RESTART_CSS}</style>
        <div className="kivotos-restart-banner" role="status">
          <span>{t("restart.waiting")}</span>
          <button type="button" onClick={cancel}>
            {t("restart.waitingCancel")}
          </button>
        </div>
      </>,
      document.body,
    );
  }
  const seconds = Math.round((Date.now() - current.since) / 1000);
  return createPortal(
    <>
      <style>{RESTART_CSS}</style>
      <div className="kivotos-restart-cover" role="alertdialog" aria-live="polite">
        <div className="kivotos-restart-card">
          {current.error === undefined ? (
            <div className="kivotos-restart-spin" aria-hidden />
          ) : null}
          <div>
            {current.error === undefined
              ? t("restart.restarting", { name: current.name })
              : t("restart.failed", { error: current.error, log: current.log ?? "" })}
          </div>
          {current.error === undefined ? <p>{t("restart.reconnecting", { seconds })}</p> : null}
          {current.error === undefined && seconds > 180 ? (
            <p>
              {t("restart.slow", { log: current.log ?? "$DSH_HOME/kivotos/restart/restart.log" })}
            </p>
          ) : null}
          {current.error !== undefined ? (
            <p>
              <button type="button" className="kivotos-btn" onClick={dismiss}>
                {t("restart.dismiss")}
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

/** After a restart: "back online" with the dsh version and what changed, once per page origin. */
export function RestartNotice({ t, peer }: { t: Translate; peer: string | null }): ReactNode {
  const [shown, setShown] = useState<RestartStatus["last"]>(null);
  useEffect(() => {
    const abort = new AbortController();
    getStatus(restartUrl(peer), abort.signal)
      .then((status) => {
        const last = status.last;
        if (last === null || last.phase !== "back" || last.backAt === undefined) return;
        if (Date.now() - last.backAt > NEWS_MS) return;
        const key = `${SEEN_KEY}:${peer ?? ""}`;
        if (window.localStorage.getItem(key) === last.id) return;
        window.localStorage.setItem(key, last.id);
        setShown(last);
        return undefined;
      })
      .catch(() => undefined);
    return () => abort.abort();
  }, [peer]);
  const dismiss = useCallback(() => setShown(null), []);
  useEffect(() => {
    if (shown === null) return undefined;
    const timer = window.setTimeout(() => setShown(null), 15_000);
    return () => window.clearTimeout(timer);
  }, [shown]);
  if (shown === null) return null;
  const changes = shown.changes ?? [];
  const version = shown.to?.dsh === undefined ? "dsh" : `dsh ${shown.to.dsh}`;
  return createPortal(
    <>
      <style>{RESTART_CSS}</style>
      <div className="kivotos-restart-toast" role="status">
        <span>{t("restart.back", { version })}</span>
        <small>
          {changes.length > 0
            ? t("restart.backChanged", { changes: changesText(changes) })
            : t("restart.backNoChange")}
        </small>
        <button type="button" onClick={dismiss}>
          {t("restart.dismiss")}
        </button>
      </div>
    </>,
    document.body,
  );
}
