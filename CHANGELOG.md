# Changelog

CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release. Write the section before tagging.

## v0.1.7

- Settings → Remote access is redesigned: a card for this computer's links, each with a state tag and labelled actions (Pair phone, Invite, Leave network), and a table with one cell per machine and link. Invite and leaving are dialogs; leaving says what goes before it does. The full reason for a state is in each cell's tooltip, or a tap away on a phone. The network id is no longer shown.
- A working link is no longer shown as down after one slow answer. Each check waits 6 s, and a link that was working stays in use, marked Unstable, until three checks in a row fail.
- A relay whose TLS handshake is reset is named as such: "Connection reset: the hosting provider may be blocking <host>", on the computer and on the phone.
- The machine switcher shows each machine on one line: a dot, the name and where it is, with "This computer · N ready" on the trigger. The arrow keys, Home and End move through it.
- Android: the home list, the long-press sheet and Connections are redesigned on the same states. Removing a machine no longer leaves its whole relay network. Connections shows whether machines answer over Tailscale and can open the Tailscale app. A refused tailnet connection now reads "Not running Kivotos".
- Android: going back to the list and opening the same machine again, or switching between machines in the sidebar, no longer reloads the page: the app keeps up to three pages loaded, and it loads the machines you switch to most ahead of time. On the emulator, a first switch went from about 1.5–1.9 s to under 0.1 s.
- A computer keeps an idle relay session from another member open for a minute instead of 5 s, so switching back to it through the relay does not set up new sessions.

### 中文

- 设置 → 远程连接 重新设计：先是一张卡片，列出本机的每种连接方式，各带状态标签和按钮（配对手机、邀请设备、退出网络）；下面是机器表格，每台机器的每种连接方式各占一格。邀请和退出网络改为弹窗，退出前会说明会失去什么。每个状态的完整原因在格子的悬停提示里，手机上点一下就能看到。不再显示网络 ID。
- 一次回应慢不再把正常的连接显示为断开。每次检查等 6 秒；原本正常的连接会继续使用并标为「不稳定」，连续 3 次失败才算连不上。
- 中继的 TLS 握手被重置时会明确提示：「连接被重置：服务商可能在屏蔽 <域名>」，电脑和手机上都有。
- 机器切换器每台机器占一行：状态点、名称和连接方式，触发按钮上显示「本机 · N 台可用」。可以用方向键、Home、End 在里面移动。
- 安卓 App：首页列表、长按菜单和「连接」页按同一套状态重新设计。移除一台机器不再顺带退出整个中继网络。「连接」页显示各台机器是否经 Tailscale 有回应，并可以打开 Tailscale App。Tailnet 连接被拒时显示「未运行 Kivotos」。
- 安卓 App：返回列表后再打开同一台机器、或在侧栏里切换机器，不再重新加载页面：App 最多保留 3 个页面，并会提前加载你最常切换的机器。模拟器上第一次切换从约 1.5–1.9 秒降到 0.1 秒以内。
- 电脑把其它成员经中继连来的空闲会话保持一分钟（原来是 5 秒），经中继切回这台电脑时不必重新建立会话。

## v0.1.6

- Each machine is listed once, wherever it is reached from, with how it is reached and, when it is not, why. A computer that is in your tailnet and in a relay network no longer shows up twice, and an unreachable one stays in the list with its reason instead of disappearing. (#11)
- Choose how each machine is reached: Auto (Tailscale when it works, the relay when it does not), Tailscale only, or Relay only. A machine held to one link never falls back silently. On a computer it is in Settings → Remote access; on the phone, long-press a machine. (#16)
- Settings → Remote access is one page: this computer's links (Tailscale and your own relay, each with its state), then every machine with a chip per link and its mode.
- A computer now shows when a session on another machine is waiting for an approval or an answer, or has finished: a count and a dot in the machine switcher, and a system notification while the window is in the background. (#12)
- Android: opening a machine is fast after the first time. The app keeps each machine's client files on disk and fetches them in the background when the machine appears, over Tailscale and over the relay alike. (#2)
- Settings → Remote access warns when the relay address is plaintext (`ws://`): anyone on the path can read the relay token and use that relay as your network. Traffic stays end-to-end encrypted and they cannot join the network. (#19)
- When a dsh update changes one of the internals Kivotos depends on, only that feature turns off and a notice names it, instead of the page breaking. A nightly check boots the newest stable dsh (`latest`/`next`) with the plugin and reports which points still fit. (#18)
- Relay: run it with Docker Compose; the READMEs download `packages/relay/docker-compose.yml`.
- Contributors: `CONTRIBUTING.md` has the prerequisites, the build and test commands for the plugin, the relay and the Android app, the conventions and the CI jobs a pull request must pass, and `npm run dev` starts a relay and two dsh instances joined to one relay network in one command. (#21)
- LICENSE is the plain Apache License 2.0 text, so GitHub and package indexes detect it.

### 中文

- 每台机器只列一次，无论从哪里连到它，并显示经由哪种方式连接；连不上时说明原因。同时在 tailnet 和中继网络里的电脑不再出现两次，连不上的机器也不会从列表里消失，而是显示原因。(#11)
- 可以为每台机器选择连接方式：自动（能直连时走 Tailscale，不通时改走中继）、只用 Tailscale、只用中继。选定一种后不会悄悄改走另一种。电脑上在 设置 → 远程连接 中设置；手机上长按机器。(#16)
- 设置 → 远程连接 合并为一页：先是本机的连接方式（Tailscale 和自建中继，各自带状态），然后是每台机器、每种连接方式的状态和连接模式。
- 另一台机器上的会话等待审批或回答、或已完成时，电脑上也会提示：机器切换器里显示数量和圆点，窗口在后台时发系统通知。(#12)
- 安卓 App：再次打开同一台机器很快。App 会把每台机器的客户端文件存在本地，并在机器出现时后台预先下载，Tailscale 和中继都适用。(#2)
- 设置 → 远程连接：中继地址是明文（`ws://`）时会给出警告——路径上的任何人都能读到中继令牌，借这个中继冒充你的网络。流量仍是端到端加密的，对方也加入不了网络。(#19)
- dsh 更新改动了 Kivotos 依赖的某处内部结构时，只停用对应的功能并提示是哪一项，页面不再整体出错。每晚的检查会用最新的稳定版 dsh（`latest`/`next`）加载插件，报告哪些依赖点仍然吻合。(#18)
- 中继：可以用 Docker Compose 运行；README 改为下载 `packages/relay/docker-compose.yml`。
- 贡献者：`CONTRIBUTING.md` 写清了前置条件、插件/中继/安卓 App 的构建与测试命令、约定和 PR 必须通过的 CI 任务；`npm run dev` 一条命令起一个中继和两个同属一个中继网络的 dsh 实例。(#21)
- LICENSE 改为标准的 Apache License 2.0 原文，GitHub 和各包索引能正确识别。

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
