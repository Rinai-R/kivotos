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

Kivotos 是 DeepSeek Harness（dsh）的插件。它让你在任意一个 dsh 中，以 dsh 的完整界面打开并操作 tailnet 上的每一个 dsh，同时为 dsh 提供完整的手机布局。Kivotos 没有自己的界面：你看到的每个页面都是 dsh 本身的界面。

## 功能

- **基于 Tailscale 的联邦。** 在任意 dsh 中，可以打开 tailnet 上其他同样运行 Kivotos 的 dsh 的完整界面。远程界面就是远端 dsh 自己的界面，通过反向代理提供，而不是重新实现，因此以下功能在远程均可使用：
  - 会话：新建、删除、归档
  - 审批与用户提问
  - 模型列表与切换
  - 设置
  - 工作区文件
  - 终端
- **机器切换器。** 位于 dsh 侧边栏底部、设置入口上方，列出“本机”以及当前服务主机挂载的对等节点。选择后跳转到 `/` 或 `/kivotos/peer/<id>/`。
- **手机布局。** 宽度小于 768px 时：
  - 单栏布局；侧边栏变为滑出抽屉（`min(86vw, 320px)`），并带有点击即可关闭的半透明遮罩
  - 会话标题前有一个抽屉开关按钮
  - 输入框固定在底部（使用 dsh 自身的 sticky composer），并适配安全区域与 `viewport-fit=cover`
  - 输入控件字号为 16px，iOS 聚焦时不会自动缩放
  - 只使用 dsh 主题变量，支持浅色和深色

## 环境要求

- DeepSeek Harness（dsh）`0.2.1-alpha.1`
- Node `^22.19.0 || >=24`
- 每台机器都安装并登录 Tailscale，且所有机器登录同一个 tailnet 账号

## 安装

在每台机器上执行：

```sh
git clone git@github.com:Rinai-R/kivotos.git
dsh plugin --profile web add /absolute/path/to/kivotos/packages/kivotos
```

重启 dsh。在每一台需要访问或被访问的机器上重复以上步骤。

确认插件已注册，输出中应包含 `kivotos` 条目：

```sh
dsh --profile web --dump-config
```

以上命令使用 `web` profile。桌面应用使用 `desktop` profile，尚未与 Kivotos 一起测试过。

## 在电脑上使用

照常打开 dsh。侧边栏底部的机器切换器会列出本机和所有已发现的对等节点。选择某个对等节点即可在 `/kivotos/peer/<id>/` 打开它的完整界面；选择“本机”回到 `/`。

## 在手机上使用

1. 在手机上安装 Tailscale 应用，并登录与电脑相同的 tailnet 账号。
2. 在手机浏览器中打开电脑的 tailnet 监听地址：
   - `http://<computer's tailscale IP>:7380/`
   - 或者在 tailnet 启用 HTTPS 证书后使用 `https://<name>.<tailnet>.ts.net:7380/`
3. 在该页面上通过机器切换器访问其他机器。

不需要令牌，也不需要登录：tailnet 身份就是登录凭据。

通过 Tailscale 的明文 HTTP 由 WireGuard 加密，但浏览器不会把该页面视为安全上下文，因此部分浏览器 API（例如剪贴板）可能不可用。为 tailnet 启用 HTTPS 证书即可解决，参见 [Tailscale HTTPS 证书](https://tailscale.com/kb/1153/enabling-https)。

手机布局已在浏览器中以 390x844 尺寸验证。在真实手机上使用以及两台物理机器之间的使用尚未验证。

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
```

匹配的覆盖项会替换该行的整个 `config` 对象；未写出的键使用上面的默认值。

`tls: auto` 会在 tailnet 启用了 HTTPS 证书时使用 HTTPS，并通过 `tailscale cert` 将证书签发到 `$DSH_HOME/kivotos/tls/`。`on` 表示必须使用 HTTPS，`off` 表示从不使用。Kivotos 从不运行 `tailscale serve`，也从不修改 Tailscale 配置。

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

Kivotos 锁定 dsh `0.2.1-alpha.1`。dsh 本身没有手机布局，也没有插槽负责整体框架网格，因此手机样式表依赖 dsh 的内部实现（0.2.1-alpha.1 的 CSS module 类名和 data 属性）。index 改写（viewport meta、manifest 链接）同样匹配 0.2.1-alpha.1 的确切标记，标记变化后会静默失效。每次升级 dsh 后都需要重新验证 Kivotos。

## 开发

插件位于 `packages/kivotos/`，是纯 ESM JavaScript，没有构建步骤，也没有运行时依赖。仓库根目录下的脚本：

```sh
npm run typecheck     # tsc --checkJs
npm run lint          # oxlint
npm run format        # oxfmt
npm run format:check  # oxfmt，仅检查
npm run build         # node --check
npm test              # node --test
```

lefthook 的 pre-commit 钩子会运行格式检查、lint 和类型检查。

如需在一台机器上测试联邦功能，可运行两个装有 Kivotos 的 dsh 实例，为每个实例设置不同的 `port`，设置 `allowSelf: true`，并通过 `staticPeers` 让它们互相指向对方。

## 许可证

Apache-2.0。参见 [LICENSE](LICENSE) 和 [NOTICE](NOTICE)。

Kivotos 与 DeepSeek 和 Tailscale 均无关联。
