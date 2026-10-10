# Changelog

Release notes for every Kivotos version. CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release, so write the section before tagging.

## v0.1.3

Find out why a phone feels slow, and a Settings page that fits it.

- **Trace log.** Kivotos writes one JSON line per event to `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl` (7 days kept, 50 MB per day). The new `trace` option chooses how much: `off`, `requests` (default) or `frames`.
  - Every request to the tailnet listener: who asked, admission time, status, time to first byte, total time, bytes each way.
  - Every forwarded WebSocket: handshake time, duration and bytes; at `frames`, every frame's direction, size and time.
  - The phone page reports its own view once per load: navigation phases, each resource's time and size, and when the dsh frame first rendered.
  - Paths are recorded without their query string, which can carry a login token.
- **Settings on phones.** Below 768px the dsh Settings panel fills the screen, its section rail becomes a scrolling tab row, and the appearance cards share one row. Before, the options were squeezed into a 157px column.
- **"Pair phone" is hidden on phones.** The pairing code is for a phone to scan, so the phone no longer shows it. Computers still do.
- Concurrent requests from one address share a single `tailscale whois` lookup.

Install with `dsh plugin --profile web add kivotos`, then restart dsh; for the desktop app see the README. The Android app has no changes besides its version.

### 中文

查清手机为什么慢，以及适配手机的设置页。

- **追踪日志。** Kivotos 把每个事件写成一行 JSON，存到 `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl`（保留 7 天，每天上限 50 MB）。新增 `trace` 选项控制详细程度：`off`、`requests`（默认）或 `frames`。
  - 发往 tailnet 监听的每个请求：来源、准入耗时、状态码、首字节时间、总耗时、上下行字节数。
  - 每条转发的 WebSocket：握手耗时、持续时间和字节数；`frames` 下还记录每一帧的方向、大小和时间。
  - 手机页面每次加载上报一次自己看到的情况：导航各阶段、每个资源的耗时和大小，以及 dsh 界面框架首次渲染的时间。
  - 记录路径时去掉查询串，因为其中可能带登录令牌。
- **手机上的设置页。** 宽度小于 768px 时，dsh 设置面板全屏显示，分区导航变成可横向滚动的标签栏，外观卡片排成一行。此前选项区只有 157px 宽。
- **手机上不再显示“配对手机”。** 配对码是给手机扫的，手机自己不需要；电脑上照常显示。
- 同一地址的并发请求共用一次 `tailscale whois` 查询。

用 `dsh plugin --profile web add kivotos` 安装后重启 dsh；桌面版的装法见 README。安卓 App 除版本号外没有变化。

## v0.1.2

The plugin is on npm, and the phone composer stays above the keyboard.

- **Install from npm.** The plugin is published as the unscoped package `kivotos`: `dsh plugin --profile web add kivotos`. Every release tag publishes it with provenance.
- **Targets dsh 0.2.0-rc.2**, the version the DeepSeek Harness desktop app ships. The READMEs explain installing into the desktop app.
- **Android: the composer stays above the keyboard.** On Android 15 the composer sat under the soft keyboard and the conversation went blank after it closed.
- **Phone drawer closes on pick.** Opening a Session from the drawer, or starting a new one, closes the drawer.

### 中文

插件上架 npm，手机输入框不再被键盘挡住。

- **从 npm 安装。** 插件以无作用域的包名 `kivotos` 发布：`dsh plugin --profile web add kivotos`。每个发布标签都会附带来源证明发布到 npm。
- **面向 dsh 0.2.0-rc.2**，即 DeepSeek Harness 桌面版自带的版本。README 说明了如何装进桌面版。
- **安卓：输入框保持在键盘上方。** 在 Android 15 上，输入框会被软键盘挡住，键盘收起后对话区还会变空白。
- **选中后收起抽屉。** 在手机抽屉里打开会话或新建会话后，抽屉自动收起。

## v0.1.1

Pair a phone by scanning a QR code, and an app that looks like dsh.

- **Pair by QR code.** The dsh machine switcher gains "Pair phone", which shows a QR code holding the computer's tailnet listener address (no token). The app scans it; manual entry stays as a fallback.
- **Redesigned app.** The app's own screens use dsh's theme, with a first-run guide, a grouped machine list, a full-screen scanner, and loading and offline states around the dsh page. Phones and tablets, light and dark.
- **Fix: crash on reboot.** On Android 15 the app crashed on every reboot with notifications on. The notification stream now resumes when the app is next opened.

### 中文

扫码配对手机，App 外观与 dsh 一致。

- **扫码配对。** dsh 的机器切换器新增“配对手机”，显示一个只含电脑 tailnet 监听地址的二维码（不含令牌）。App 扫码即可，仍可手动输入。
- **App 重新设计。** App 自己的页面采用 dsh 的主题，加入首次使用引导、分组的机器列表、全屏扫码，以及 dsh 页面的加载和离线状态。适配手机和平板、浅色和深色。
- **修复：重启后崩溃。** 在 Android 15 上，开启通知后每次重启手机 App 都会崩溃。现在通知流会在下次打开 App 时恢复。

## v0.1.0

First release: Kivotos as a DeepSeek Harness plugin, with an Android app.

- **Every dsh on your tailnet, from any dsh.** The machine switcher opens another computer's complete dsh UI: Sessions, approvals, questions, models, settings, files and terminal. Only Tailscale identity is checked.
- **Phone layout.** A single column with a drawer sidebar, the composer fixed at the bottom, and safe areas respected.
- **Android app.** Opens each machine's dsh UI and notifies you of approvals, questions and finished tasks.

### 中文

首个版本：作为 DeepSeek Harness 插件的 Kivotos，以及安卓 App。

- **在任意一台 dsh 上打开 tailnet 里的每一台 dsh。** 机器切换器可以打开另一台电脑完整的 dsh 界面：会话、审批、提问、模型、设置、文件和终端。只校验 Tailscale 身份。
- **手机布局。** 单列，侧边栏变为抽屉，输入框固定在底部，并避开安全区。
- **安卓 App。** 打开每台机器的 dsh 界面，并在需要审批、提问或任务完成时发通知。
