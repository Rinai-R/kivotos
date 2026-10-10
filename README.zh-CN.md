<p align="center">
  <img src="assets/kivotos-logo.svg" width="64" height="64" alt="Kivotos logo">
</p>

<h1 align="center">Kivotos</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a>
</p>

Kivotos 是 DeepSeek Harness（dsh）的插件。它让你在任意一个 dsh 中，以 dsh 的完整界面打开并操作 tailnet 上的每一个 dsh，为 dsh 提供完整的手机布局，并附带一个安卓 App，在会话需要你时通知你。会话页面全部是 dsh 本身的界面，Kivotos 不另做一套。

## 功能

- **基于 Tailscale 的联邦。** 在任意 dsh 中，可以打开 tailnet 上其他同样运行 Kivotos 的 dsh 的完整界面。远程界面就是远端 dsh 自己的界面，通过反向代理提供，而不是重新实现，因此以下功能在远程均可使用：
  - 会话：新建、删除、归档
  - 审批与用户提问
  - 模型列表与切换
  - 设置
  - 工作区文件
  - 终端
- **机器切换器。** 位于 dsh 侧边栏底部、设置入口上方，列出“本机”以及当前服务主机挂载的对等节点。选择后跳转到 `/` 或 `/kivotos/peer/<id>/`。
- **手机布局。** 宽度小于 768px，且页面在 Kivotos App 内或在以触摸为主的设备上时生效（缩窄的桌面窗口仍是 dsh 自己的布局）：
  - 单栏布局；侧边栏变为滑出抽屉（`min(86vw, 320px)`），并带有点击即可关闭的半透明遮罩
  - 会话标题前有一个抽屉开关按钮
  - 输入框固定在底部（使用 dsh 自身的 sticky composer），并适配安全区域与 `viewport-fit=cover`
  - 输入控件字号为 16px，iOS 聚焦时不会自动缩放
  - 只使用 dsh 主题变量，支持浅色和深色
- **安卓 App。** 打开每台机器的完整 dsh 界面；当会话需要审批、向你提问或任务完成，而你当前没在看这个会话时，用系统通知加弹窗提醒你。点通知直达该会话。

## 环境要求

- DeepSeek Harness（dsh）`0.2.0-rc.2`
- Node `^22.19.0 || >=24`
- 每台机器都安装并登录 Tailscale，且所有机器登录同一个 tailnet 账号

## 安装

在每台机器上从 npm 安装已发布的插件包：

```sh
dsh plugin --profile web add kivotos
```

重启 dsh。在每一台需要访问或被访问的机器上重复以上步骤。

如需从源码运行（开发用），先构建插件，再添加它的目录：

```sh
git clone git@github.com:Rinai-R/kivotos.git
cd kivotos
npm install   # 安装构建工具，并构建 packages/kivotos/dist/
dsh plugin --profile web add "$PWD/packages/kivotos"
```

确认插件已注册，输出中应包含 `kivotos` 条目：

```sh
dsh --profile web --dump-config
```

以上命令使用 `web` profile。DeepSeek Harness 桌面应用使用 `desktop` profile：请先完全退出桌面应用，再用应用内自带的命令行安装（普通的 `dsh` 会拒绝操作 `desktop` profile），然后重新打开应用：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add kivotos
```

同一时间只在一个运行中的 profile 里装 Kivotos：每个 Kivotos 都会监听 7380 端口。

## 在电脑上使用

照常打开 dsh。侧边栏底部的机器切换器会列出本机和所有已发现的对等节点。选择某个对等节点即可在 `/kivotos/peer/<id>/` 打开它的完整界面；选择“本机”回到 `/`。

## 在手机上使用

### 安卓 App

1. 在手机上安装 Tailscale 应用，并登录与电脑相同的 tailnet 账号。
2. 从最新的 [GitHub Release](https://github.com/Rinai-R/kivotos/releases) 下载 `Kivotos-v*.apk` 并安装。尚未发布的构建可从 GitHub Actions 下载 `kivotos-android`，或自行构建（见“开发”）。
3. 在电脑上保持装有 Kivotos 的 dsh 运行。在其侧边栏的机器切换器中点击“配对手机”，显示二维码；在手机 App 中点击“扫码配对”并扫描。App 会确认电脑有响应且允许手机访问。每台电脑扫码一次即可。无法扫码时可手动输入**电脑的** Tailscale IP 和监听端口，不要输入手机自己的 IP。
4. 打开 **通知**。安卓会请求通知权限；App 提示时请允许 Kivotos 在后台运行，否则系统可能为省电停止通知。
5. 点某台机器即可打开它的完整 dsh 界面。

通知开启后，App 会对每台机器保持一条连接（安卓会显示一条常驻的"正在关注 N 台机器"通知）。当某个会话出现以下情况时，你会收到带弹窗的系统通知：

- 需要审批（通知里会写明要执行什么），
- 向你提问，
- 任务完成或失败。

你在 App 里正在看的会话不会弹通知；打开某个会话会清除它的通知；审批或提问在任何地方处理后，对应通知会自动撤回。点通知会在对应机器上打开该会话。App 停留在其他页面时，同样的事件还会以 App 内横幅出现。

App 只支持安卓，用 Expo（React Native）构建；dsh 页面是 WebView 中 dsh 自己的界面。通知来自每台电脑上的 Kivotos，而不是推送服务，因此不需要谷歌服务。

二维码只包含电脑的 tailnet 监听地址，不包含登录令牌。安卓上的 Tailscale App 不向 Kivotos 开放设备列表；首次扫码配对后，Kivotos 会记住这台电脑。

### 浏览器

也可以在手机浏览器中打开电脑的 tailnet 监听地址：

- `http://<computer's tailscale IP>:7380/`
- 或者在 tailnet 启用 HTTPS 证书后使用 `https://<name>.<tailnet>.ts.net:7380/`

在该页面上通过机器切换器访问其他机器。浏览器方式没有通知。

两种方式都不需要令牌，也不需要登录：tailnet 身份就是登录凭据。

通过 Tailscale 的明文 HTTP 由 WireGuard 加密，但浏览器不会把该页面视为安全上下文，因此部分浏览器 API（例如剪贴板）可能不可用。为 tailnet 启用 HTTPS 证书即可解决，参见 [Tailscale HTTPS 证书](https://tailscale.com/kb/1153/enabling-https)。

App 和手机布局已在安卓 15 模拟器上、以及浏览器中以 390x844 尺寸验证。在真实手机上使用以及两台物理机器之间的使用尚未验证。

## 配置

插件的配置行 id 为 `kivotos`，可在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中覆盖。默认值：

```yaml
- id: kivotos
  config:
    port: 7380 # tailnet 监听端口，所有机器保持一致
    tls: auto # auto | on | off
    discover: true # 探测同一用户的 tailnet 节点
    refreshSeconds: 30 # 5..3600
    listen: true # 在本机运行 tailnet 监听器
    listenHost: "" # "" = 本节点的 Tailscale IPv4 地址
    allowSelf: false # 允许来自本节点自身地址的请求（仅用于实验环境）
    tailscale: tailscale # CLI 路径
    staticPeers: [] # [{ id, name, host, port, tls?, servername? }]
    trace: requests # off | requests | frames
```

匹配的覆盖项会替换该行的整个 `config` 对象；未写出的键使用上面的默认值。

`tls: auto` 会在 tailnet 启用了 HTTPS 证书时使用 HTTPS，并通过 `tailscale cert` 将证书签发到 `$DSH_HOME/kivotos/tls/`。`on` 表示必须使用 HTTPS，`off` 表示从不使用。Kivotos 从不运行 `tailscale serve`，也从不修改 Tailscale 配置。

## 追踪日志

Kivotos 会记录它如何为手机和其他机器提供服务，每行一个 JSON 对象，写入 `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl`（默认是 `~/.dsh/kivotos/logs/`）。超过 7 天的文件会被删除，每天的文件上限为 50 MB。记录的路径不含查询参数。

| `event`                            | 记录内容                                                                                                                                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`                             | 每个发到 tailnet 监听端口的请求：客户端 IP 和节点、准入耗时（`admitMs`；`cached` 表示是否跳过了 `tailscale whois`）、状态码、首字节时间（`ttfbMs`）、总耗时（`totalMs`）、上下行字节数、`content-encoding`、`cache-control` |
| `ws.open`、`ws`                    | 每条 WebSocket（dsh 的 `remote.mux`）：握手耗时、持续时长、上下行字节数                                                                                                                                                     |
| `ws.frame`                         | 仅在 `trace: frames` 时记录：每个 WebSocket 帧的方向、大小，以及距连接建立的毫秒数                                                                                                                                          |
| `client`                           | 手机页面自己上报：导航各阶段，以及手机端看到的每个资源的耗时、首字节时间和大小，还有 dsh 界面框架首次渲染的时间（`shellReadyMs`）                                                                                           |
| `sse.open`、`sse.close`            | 安卓 App 的通知事件流                                                                                                                                                                                                       |
| `peer.http`、`peer.ws`             | 本机转发给其他机器的请求                                                                                                                                                                                                    |
| `login`、`probe`、`listener.start` | 本地登录、对等节点探测、监听启动                                                                                                                                                                                            |

排查会话加载慢时用 `trace: frames`：它能看出 dsh 界面通过 WebSocket 发出的每个请求，以及回应何时发回。在配置行里打开它，重启 dsh，复现一次，再查看当天的文件。

## 安全

**任何登录了你的 tailnet 账号的人，都能完全控制该 tailnet 上每一个运行 Kivotos 的 dsh**，等同于坐在那台电脑前：执行命令、读写文件、使用终端、批准工具调用。只校验 Tailscale 身份，没有第二重验证。请保护好 tailnet 账号，不要共享。

tailnet 监听器只在满足以下全部条件时接受请求：

- `Host` 头指向本节点（其 Tailscale IP 或 MagicDNS 名称），否则返回 421
- 请求不是跨站请求：没有 `Sec-Fetch-Site: cross-site`，且 `Origin`（如有）与请求的 authority 一致，否则返回 403
- 对远端地址执行 `tailscale whois` 的结果与本节点属于同一个 tailnet 用户，否则返回 403。带 tag 的设备、设备共享以及共享 tailnet 中的其他用户都会被拒绝
- 请求不是来自本节点自身的地址，除非设置了 `allowSelf: true`

监听器只绑定 Tailscale 地址，不绑定 `0.0.0.0`，也不绑定局域网地址。服务端 dsh 上的对等节点挂载点位于 dsh 自身的连接防护之后（dsh 登录 cookie 以及 Host 和 Origin 校验）。

漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 工作原理

- 每个运行 Kivotos 的 dsh 会只在其 Tailscale 地址上开启第二个 HTTP 监听器（默认端口 7380），dsh 本身仍只监听回环地址。通过校验的请求会携带 Kivotos 在进程内获取的 dsh 登录 cookie 转发给本机 dsh；浏览器永远看不到这个 cookie。
- 每隔 `refreshSeconds`，Kivotos 读取 `tailscale status --json`，选出同一 tailnet 用户下在线的节点，在 `port` 上探测 `GET /kivotos/hello`（先 HTTPS，后 HTTP），挂载有响应的节点，并加上 `staticPeers` 中配置的节点。
- 每个对等节点在服务端 dsh 上挂载于 `/kivotos/peer/<id>/`，位于 dsh 的连接防护之后，并转发到该节点的 tailnet 监听器。每个对等节点页面拥有独立的 `localStorage` 命名空间，避免同源下的多个节点界面互相覆盖客户端状态。
- 跳转不会级联。挂载点会给转发的请求打标记，并以 508 拒绝已带标记的请求，因此 `/kivotos/peer/b/kivotos/peer/a/` 不可用。机器列表始终来自当前服务主机。

## 兼容性

Kivotos 锁定 dsh `0.2.0-rc.2`。dsh 本身没有手机布局，也没有插槽负责整体框架网格，因此手机样式表依赖 dsh 的内部实现（0.2.0-rc.2 的 CSS module 类名和 data 属性）。index 改写（viewport meta、manifest 链接）同样匹配 0.2.0-rc.2 的确切标记，标记变化后会静默失效。每次升级 dsh 后都需要重新验证 Kivotos。

## 开发

插件位于 `packages/kivotos/`：TypeScript 源码在 `src/`，用 esbuild 构建到 `dist/`，dsh 加载的是 `dist/`。没有运行时依赖。仓库根目录下的脚本：

```sh
npm run build         # esbuild：src/ -> dist/（npm install 也会执行）
npm run typecheck     # tsc --noEmit
npm run lint          # oxlint
npm run format        # oxfmt
npm run format:check  # oxfmt，仅检查
npm test              # 直接在 TypeScript 源码上运行 node --test
```

修改 `src/` 后运行 `npm run build` 并重启 dsh。

lefthook 的 pre-commit 钩子会运行格式检查、lint 和类型检查。

如需在一台机器上测试联邦功能，可运行两个装有 Kivotos 的 dsh 实例，为每个实例设置不同的 `port`，设置 `allowSelf: true`，并通过 `staticPeers` 让它们互相指向对方。

安卓 App 位于 `packages/mobile/`（Expo SDK 57，React Native）。它的通知服务是一个用 Kotlin 写的本地 Expo 模块：`packages/mobile/modules/kivotos-attention/`。构建 APK 需要 JDK 17 和安卓 SDK（`ANDROID_HOME`）：

```sh
npm install
npm run apk -w packages/mobile   # expo prebuild，然后 gradlew assembleRelease
# -> packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

`packages/mobile/android/` 由 `expo prebuild` 生成，不提交到仓库。Release APK 使用调试密钥签名，可以直接安装，但不适合上架应用商店。

发布版本时，将根目录、插件和 mobile 的 `package.json` 中的 `version`，以及 `packages/mobile/app.json` 中的 `expo.version` 统一更新为同一版本，并递增 `expo.android.versionCode` 以支持安卓升级。在 [CHANGELOG.md](CHANGELOG.md) 中写好该版本的小节（CI 会把它作为 GitHub Release 的描述，缺少时拒绝该标签），然后推送对应的 `v<version>` 标签（例如 `v0.1.2`）。CI 检查通过并构建 APK 后，会先把 `kivotos` 发布到 npm（附带来源证明），再将 `Kivotos-v<version>.apk` 和 `Kivotos-v<version>.sha256` 上传到 GitHub Release。带连字符的标签会发布为预发行版，npm 上发布到 `next` 标签；普通 `main` 提交仍只生成临时的 Actions artifact。发布的 APK 仍使用 Expo 的调试密钥签名，仅供直接安装，不是商店分发或正式生产签名。

```sh
git tag v0.1.2
git push origin v0.1.2
```

## 许可证

Apache-2.0。参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

Kivotos 与 DeepSeek 和 Tailscale 均无关联。
