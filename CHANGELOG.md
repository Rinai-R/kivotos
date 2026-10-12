# Changelog

CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release. Write the section before tagging.

## v0.1.5

- Desktop app: opening another machine from the machine switcher no longer fails with "web boot: N entries did not activate", and that machine's live updates now come from it rather than from the computer you are on. (#3)
- Opening a machine is fast after the first time: the computer serving the page keeps the other machine's client files on disk and fetches them in the background as soon as the machine appears. Set `cacheMegabytes` (default 256, `0` turns the cache off) and `cacheWarm` (default on). Build assets can now be cached by the browser too. (#2)
- Trace records tell the plugin batches apart by a fingerprint (revision, length, hash) instead of showing every one as `/plugins/`, and the load reports of pages opened through the machine switcher are no longer lost.
- Android: the notification service no longer crashes the app after 6 hours in the background on Android 15, and it starts again after a reboot. (#1)
- Relay: published as the container image `ghcr.io/rinai-r/kivotos-relay` for amd64 and arm64. `./kivotos-relay serve` now also works from the directory that holds the binary.

### 中文

- 桌面版：从机器切换器打开另一台机器时，不再报错 “web boot: N entries did not activate”；那台机器的实时更新也确实来自它，而不是你当前这台电脑。(#3)
- 再次打开同一台机器很快：提供页面的电脑会把另一台机器的客户端文件存在本地磁盘上，并在那台机器出现时就在后台预先下载。可设置 `cacheMegabytes`（默认 256，设为 `0` 关闭缓存）和 `cacheWarm`（默认开启）。构建产物现在也能被浏览器缓存。(#2)
- 追踪日志用指纹（修订号、长度、哈希）区分各个插件包，不再全部显示为 `/plugins/`；通过机器切换器打开的页面，其加载耗时报告也不再丢失。
- 安卓 App：在 Android 15 上后台运行 6 小时后，通知服务不再导致 App 崩溃，重启手机后也会自动恢复。(#1)
- 中继：发布为容器镜像 `ghcr.io/rinai-r/kivotos-relay`，支持 amd64 和 arm64。在二进制文件所在目录运行 `./kivotos-relay serve` 现在也能正常启动。

## v0.1.4

- Connect through a relay server you run, next to or instead of Tailscale. A machine can be in a tailnet and a relay network at once. The relay (`packages/relay`, Go, with a Dockerfile) forwards end-to-end encrypted streams and cannot read them or join the network.
- dsh Settings gains **Remote access**, with a tab per way to connect: create or join a relay network, see its state, and invite other devices by link or QR code.
- Android app: scan or paste an invite to add every computer of a relay network.
- The phone layout applies only in the app or on touch devices, no longer in a narrowed desktop window.

### 中文

- 可以通过自建的中继服务器连接，与 Tailscale 并存或替代它。一台机器可以同时在 tailnet 和中继网络里。中继（`packages/relay`，Go，附 Dockerfile）只转发端到端加密的数据流，读不到内容，也无法加入网络。
- dsh 设置新增 **远程连接**，每种连接方式一个标签页：创建或加入中继网络、查看状态、用链接或二维码邀请其它设备。
- 安卓 App：扫描或粘贴邀请，即可添加中继网络里的所有电脑。
- 手机布局只在 App 内或触摸设备上生效，缩窄的桌面窗口不再触发。

## v0.1.3

- Add a trace log for diagnosing slow phone connections. One JSON line per event in `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl`; set `trace` to `off`, `requests` (default) or `frames`.
- The Settings panel fits phone screens: full screen, with the section list as a tab row on top.
- "Pair phone" no longer shows on phones.
- Fix: concurrent requests from one address each started their own `tailscale whois` process.

Android app: version bump only.

### 中文

- 新增追踪日志，用来排查手机连接慢。每个事件一行 JSON，写在 `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl`；`trace` 可设为 `off`、`requests`（默认）或 `frames`。
- 设置面板适配手机屏幕：全屏显示，分区列表变成顶部的标签栏。
- 手机上不再显示“配对手机”。
- 修复：同一地址的并发请求会各自启动一个 `tailscale whois` 进程。

安卓 App 仅更新版本号。

## v0.1.2

- The plugin is on npm as `kivotos`: `dsh plugin --profile web add kivotos`.
- Target dsh 0.2.0-rc.2, the version bundled with the desktop app.
- Android: fix the composer being covered by the keyboard on Android 15.
- Phone: the drawer closes after you open or create a session.

### 中文

- 插件已发布到 npm，包名 `kivotos`：`dsh plugin --profile web add kivotos`。
- 目标版本改为 dsh 0.2.0-rc.2，即桌面版自带的版本。
- 安卓：修复 Android 15 上输入框被键盘挡住。
- 手机：打开或新建会话后，抽屉自动收起。

## v0.1.1

- Pair a phone by scanning a QR code: "Pair phone" in the machine switcher. Manual entry still works.
- Android app redesigned to match dsh's theme, with a first-run guide and a full-screen scanner.
- Fix a crash on reboot on Android 15 when notifications were on.

### 中文

- 扫码配对手机：机器切换器里的“配对手机”。仍可手动输入地址。
- 安卓 App 按 dsh 的主题重新设计，加入首次使用引导和全屏扫码。
- 修复 Android 15 上开启通知后重启手机会崩溃。

## v0.1.0

First release.

- dsh plugin: open any other dsh on your tailnet from the machine switcher, with its full UI.
- Phone layout for the dsh UI: drawer sidebar, composer at the bottom.
- Android app, with notifications for approvals, questions and finished tasks.

### 中文

首个版本。

- dsh 插件：在机器切换器里打开 tailnet 上任意一台 dsh 的完整界面。
- dsh 界面的手机布局：侧边栏变为抽屉，输入框固定在底部。
- 安卓 App，在需要审批、提问或任务完成时发通知。
