# Changelog

CI publishes the section that matches a pushed `v<version>` tag as the description of its GitHub Release. Write the section before tagging.

## v0.4.1

### Highlights

- Relay failures no longer kill dsh. A relay peer that disappears, stalls past the ping timeout, or answers a WebSocket after the member gave up used to surface as an uncaught `error` event and exit the whole dsh process — one dropped link and a remote user's dsh was gone. Each failure now closes only that relay session, the link reconnects with backoff, and the reason is recorded in the log and the link's status.

### Fixes

- Relay streams carry a guard that handles an unobserved `error` (between two reads, an idle pooled HTTP socket, a WebSocket the relay answers after its caller gave up), on the stream itself and on the TLS sockets a secured session returns; `relayAgent` reports a refused connection through its callback instead of a rejection.
- The control connection's silence deadline is configurable: `relaySilenceSeconds` (30..600, default 70 — the protocol's own 20 s ping with three misses). Raise it on a link whose queue (bufferbloat, a saturated uplink) can run longer than that.
- Regression tests (`test/relay-crash.test.ts`) run each failure mode in a child process and fail if the process exits.

### Compatibility

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0-0`, unchanged. The relay protocol and the Android app are unchanged; no relay image rebuild is needed.

### 中文

- relay 断链不再拖垮 dsh。对端异常断开、卡过 ping 超时、或 relay 在成员放弃之后才接下 WebSocket，原来会变成未捕获的 `error` 事件让整个 dsh 进程退出——断一条链路，远控用户就失联了。现在每次失败只关闭那一个 relay 会话，链路按退避重连，原因写进日志和链路状态。
- relay 流现在自带保护：两次读之间、HTTP 连接池里闲置的、以及成员已放弃后才建立的 WebSocket，它们的 `error` 由流自己处理；`relayAgent` 用回调返回失败，不再产生未处理的 rejection。
- 控制连接的静默超时可配置：`relaySilenceSeconds`（30..600，默认 70，即协议 20 秒 ping 的三次未应答）。链路排队时间（bufferbloat、上行拥塞）更长时可以调大。
- 回归测试（`test/relay-crash.test.ts`）把每种失败放进独立子进程运行，进程退出即测试失败。

## v0.4.0

### Highlights

- Safe restart: restart dsh from **Machines → Restart dsh…** (computer and phone) or `/kivotos restart [now|idle|status|cancel]`, even when you are only connected remotely. A detached helper outlives dsh, asks it to quit cleanly, starts it again, and checks that Kivotos answers again, retrying the launch up to three times; the page shows a "restarting" cover, reconnects by itself, and then shows "back online" with the dsh version and the plugins that changed. Log: `$DSH_HOME/kivotos/restart/restart.log`.
- The dialog lists the running sessions and jobs and offers **Restart when idle** (waits until nothing runs, cancellable) or **Restart now**.

### Breaking changes

- None.

### Fixes

- None.

### Compatibility

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0-0`. Restart is supported for the macOS desktop app (relaunched through LaunchServices) and for `dsh web` started from a terminal (same command line again); it is refused, with the reason, on Windows, under systemd, and for a desktop app started with extra arguments.
- When the desktop app would ask for quit confirmation (running tasks or armed reminders), nobody can answer it remotely: Kivotos waits 15 s and then force-quits the window process. The Host still shuts down cleanly and finishes its session logs. The log and the state file record that this happened.

### 中文

- 安全重启：可在「机器 → 重启 dsh…」（电脑和手机）或 `/kivotos restart [now|idle|status|cancel]` 重启 dsh，仅远程连接时也可用。独立的辅助进程比 dsh 活得久：让 dsh 正常退出、再启动、确认 Kivotos 重新可用，启动失败最多重试三次；页面显示「正在重启」，自动重连，恢复后提示 dsh 版本和有变化的插件。日志：`$DSH_HOME/kivotos/restart/restart.log`。
- 对话框列出运行中的会话和任务，可选「空闲时重启」（等待全部结束，可取消）或「立即重启」。
- 支持 macOS 桌面端（通过 LaunchServices 重新打开）和终端启动的 `dsh web`；Windows、systemd 下及带额外参数启动的桌面端会拒绝并说明原因。桌面端需要退出确认时（有运行中的任务或已设定的提醒），远程无法点击，Kivotos 等待 15 秒后强制结束窗口进程，Host 仍会正常关闭并写完会话日志。

## v0.3.1

### Highlights

- Support DeepSeek Harness 0.2.2-rc.1, the release the desktop app ships now. The index rewrites, the page probes, the desktop boot guard and every adapter marker were re-verified against it, and the pinned index fixture is re-captured from it. 0.2.1-rc.5 keeps working.

### Breaking changes

- None.

### Fixes

- Session titles in the phone's notifications and the switcher's attention badges are read from dsh's `sessionTitle` service instead of `sessionProjections.stateOf(session, "title")`, which dsh 0.2.2 deprecates and logs a warning for on first use.
- The plugin manifest now declares `engines.dsh` (`>=0.2.1-rc.5 <0.3.0-0`), so dsh's plugin manager checks the supported range itself instead of loading Kivotos into a release it was never verified on.

### Compatibility

- DeepSeek Harness `>=0.2.1-rc.5 <0.3.0-0` (verified on 0.2.1-rc.5 and 0.2.2-rc.1). The Android app and the relay are unchanged; an existing 0.3.0 app and relay keep working with this plugin.

### 中文

- 支持 DeepSeek Harness 0.2.2-rc.1（桌面端当前随附的版本）：index 改写、页面探测、桌面启动保护和所有适配器标记都已在新版本上重新验证，固定 index 夹具改为从 0.2.2-rc.1 采集；0.2.1-rc.5 仍可用。
- 会话标题改从 dsh 的 `sessionTitle` 服务读取，不再用 0.2.2 已弃用、首次调用会打警告的 `sessionProjections.stateOf(session, "title")`。
- 插件清单声明 `engines.dsh`（`>=0.2.1-rc.5 <0.3.0-0`），由 dsh 插件管理器自行检查支持范围。

## v0.3.0

- How a machine is reached is now a priority with a fallback instead of an exclusive link: Tailscale first (the default, the relay when it fails) or the relay first (the tailnet listener when it fails). The computer's Remote access dropdown and the phone's long-press sheet offer exactly these two, a machine with one link shows no choice, and a saved `auto` from an older version reads as the default (Tailscale first). `POST /kivotos/mode` takes only the two values; `auto` is refused now.
- The Android app's doors dial the machine's preferred link first and fall back to the other, so a relay-first machine reaches a computer whose relay is down over Tailscale and a Tailscale-first one still falls back to the relay; the notification stream follows the same choice.
- On a phone, Enter in the composer writes a line break instead of sending: dsh sends on a plain Enter and writes the line break for Shift+Enter, and a phone's keyboard has no Shift; the send button still sends.
- On a phone, the welcome page no longer leaves a large blank at the top with the hero pushed down the screen: dsh centers that hero and a phone's tall screen turned the centering into blank space; a conversation with messages keeps dsh's layout.
- In the Kivotos app the page no longer adds the system's safe-area insets on top of the app's own padding: a WebView that reports them (a phone with a display cutout) left a blank strip above the header, which an emulator without a cutout never showed.
- A file dropped or picked on another machine's page in the desktop window now uploads to that machine: the desktop preload exposes this computer's file paths to the page as well, and dsh wrote them into the draft as references the other machine could not resolve. A dropped directory and files pasted from the clipboard keep dsh's behaviour.
- Opening another machine from a machine's page in the phone app now goes through that machine when it is the faster way there: if the phone's own route to the target is not a direct Tailscale one (no row for it, its probe found no route, or only the relay reaches it) and the page's computer lists it with a route, the app opens it as that computer's mount (`/kivotos/peer/<id>/`), reusing the page's door and cache instead of dialling the target over the relay itself. A direct Tailscale route is still used directly, as the fastest way. The pages loaded ahead follow the same choice, so the warmed page is the one the switch shows.

### 中文

- 每台机器的连接方式不再固定走某一条链路，而是两个优先级、失败自动回落：优先 Tailscale（默认，不通时改走中继）或优先中继（不通时改走 Tailscale）。电脑的「远程连接」下拉框和手机的长按面板都只有这两项；只有一条链路的机器不显示选择；旧版本保存的 `auto` 读入后等于默认值（优先 Tailscale）。`POST /kivotos/mode` 只接受这两个值，`auto` 会被拒绝。
- 安卓 App 的门先走机器首选的链路，失败再走另一条：优先中继的机器在中继不通时改走 Tailscale，优先 Tailscale 的机器仍会回落到中继；通知流也跟随同一选择。
- 手机输入框里的回车现在是换行，不再把消息发出去：dsh 对纯回车是发送、对 Shift+回车才是换行，而手机键盘没有 Shift；发送仍然用发送按钮。
- 手机上的欢迎页不再在顶部留出一大片空白：dsh 会把欢迎页的标题和输入框垂直居中，手机屏幕更高，空白就被放大了；现在欢迎页靠上，有消息的会话维持 dsh 原样。
- 在 Kivotos App 里，页面不再在 App 自己留出的安全区之上再叠一层系统安全区：会报告安全区的 WebView（有刘海/挖孔的真机）原来会在顶部多留一条空白，而没有 cutout 的模拟器复现不出来。
- 在桌面窗口里打开另一台机器的页面时，拖入或选择文件现在会真正上传到那台机器：桌面端 preload 会把本机文件路径也暴露给该页面，dsh 原来只把路径写成引用，对端解析不到。拖入文件夹、从剪贴板粘贴文件维持 dsh 原有行为。
- 手机 App 里从一台机器的页面打开另一台机器时，如果手机自己过去更慢（没有它的机器行、探测没有路由，或只有中继可达），而当前页面的电脑列出它有路由，App 现在会经这台电脑打开它（`/kivotos/peer/<id>/`），复用该页面的门和缓存，而不是让手机自己走中继。有 Tailscale 直达时仍然直连（最快）。预加载也按同样的选择，预热的就是切换时会显示的页面。

## v0.2.2

- The machine switcher no longer shows attention marks for the machine currently on screen, this computer or a peer page: dsh shows that machine's own approvals and turns itself. Other machines keep their marks; no stuck dot on the machine in front.

### 中文

- 机器切换器不再显示当前前台机器的 attention 标记，无论是本机还是 peer 页面：那台机器自己的审批和任务由 dsh 界面显示。其他机器仍然保留标记；前台机器不会再出现清不掉的红/黄/绿点。

## v0.2.1

- A finished turn on this computer no longer leaves a machine-switcher dot that never clears: the current machine marks only the Session on screen as seen, so switching to the Session that finished clears its dot, while a turn that finishes in another Session still shows one.

### 中文

- 本机完成的任务不再留下一个永远清不掉的机器切换器圆点：只有当前显示的 Session 会被标记为已读，切到完成的那条会话后圆点消失；在别的会话里完成的任务仍然会显示圆点。

## v0.2.0

- The machine switcher no longer lists this computer twice when an old relay identity of it (same name and OS, an earlier node id) is no longer reported: that entry is dropped instead of being kept as an offline machine.
- This computer's own approvals, questions and finished turns now appear on its row in the machine switcher (and the trigger), like another machine's, including a turn that finished in a Session that is not on screen.
- Switching Sessions on a phone no longer opens the software keyboard: dsh focuses the composer by itself after a Session switch, and the page now blurs that focus unless the last press was inside the composer. A tap on the composer still types as before.

### 中文

- 机器切换器不再把同一台电脑显示两次：当它旧的 relay 身份（同名同 OS、旧的 node id）不再被上报时，这条记录会直接丢掉，而不是保留成离线机器。
- 本机自己的审批、提问和已完成的任务现在也会出现在机器切换器里本机那一行（以及触发器上），和其他机器一样；不在当前会话里完成的任务也会显示。
- 手机上切换会话不再弹出输入法：dsh 在切换会话后会自己 focus 输入框，现在除非最后一次按下发生在输入框内，页面会立即 blur；主动点输入框仍然正常输入。

## v0.1.9

- The right Sidebar previews audio files (mp3, wav, flac, ogg/oga, m4a, aac and opus) with a native player, and the Files header can open an absolute or workspace-relative path in the preview.
- The right Sidebar previews video files (mp4, m4v, mov, webm and ogv) with a native player, the same way it previews audio.
- A machine opened through Kivotos no longer shows the host-local "Open in" controls, which would launch applications on the other machine. The machine's own page keeps them.
- A phone that misses a dsh plugin batch asks the host what the batch is made of and downloads only the pieces it does not already hold, keyed by content and shared across machines. The host offers a manifest only when its rows add up to the batch byte for byte; the phone stores the assembled batch only when its size and SHA-256 match. Anything else fetches the batch whole, so a plugin update no longer re-downloads the whole ~9 MB batch: only the changed rows are fetched. On a cold cache with six or more rows it fetches the batch once and splits it locally against the manifest, instead of one request per row.
- The phone's Back goes back inside dsh first, the way a native app's stack does: it closes an open menu, the machine switcher, Settings or a dialog that has a close button, then takes a conversation back to its Session list; only from the Session list does it return to the machine list. A computer with an older Kivotos keeps the old behavior.

### 中文

- 右侧栏可以用原生播放器预览音频文件（mp3、wav、flac、ogg/oga、m4a、aac、opus），文件页头也可以按绝对路径或相对路径打开预览。
- 右侧栏可以用原生播放器预览视频文件（mp4、m4v、mov、webm、ogv），和音频预览的方式一致。
- 通过 Kivotos 打开的机器页面不再显示「用 xxx 打开」：这些操作会在另一台机器上启动应用。机器自己的页面仍然保留。
- 手机缺少 dsh 插件包时，先向宿主机询问这个包由哪些片段组成，只下载自己没有的片段；片段按内容寻址并跨机器共享。宿主机只有在逐字节核对片段能拼回整个包后才提供 manifest；手机只有在拼出的总大小和 SHA-256 匹配时才落盘。任何一步不对就回退整包下载。升级一个插件后不再重下整个约 9 MB 的包，只下载变化的行。空缓存且片段有 6 个以上时，先整包下载一次并在本地按 manifest 切开，避免一行一个请求。
- 手机上的返回键先在 dsh 内部回退，和原生 App 的页面栈一致：先关掉打开的菜单、机器切换器、设置页或带关闭按钮的弹窗，再从会话回到会话列表；只有在会话列表时才回到机器列表。电脑上的 Kivotos 较旧时保持原来的行为。

## v0.1.8

- Android: a machine page that cannot be reached shows the app's cover with the reason each link failed instead of Chromium's error page, and retries after 2, 5 and 10 seconds and then every 15 seconds. It retries at once when the app returns to the foreground or the network changes, and pauses while the app is in the background.
- Target dsh 0.2.1-rc.2: the pinned release, the index fixture and the prerequisites now name it. Every coupling point still fits — the index rewrites, boot graph, desktop boot gate, phone frame and Session store — and the nightly check passes against it.

### 中文

- 安卓：机器页面连不上时不再显示 Chromium 的错误页，而是显示 App 自己的提示卡，说明每种连接方式失败的原因；会在 2、5、10 秒后各重试一次，之后每 15 秒重试，回到前台或网络变化时立即重试，后台时暂停。
- 适配 dsh 0.2.1-rc.2：固定版本、index 测试夹具和前置条件都改为该版本。所有依赖点（index 改写、boot graph、桌面启动门、手机框架、Session 存储）仍然吻合，针对它的夜间检查通过。

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
