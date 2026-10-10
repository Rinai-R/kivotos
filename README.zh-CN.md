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

<p align="center">在任意一台电脑或手机上，使用你的每一个 DeepSeek Harness。</p>

Kivotos 是 DeepSeek Harness（dsh）的开源插件。在任意一台机器上打开其它机器的 dsh，界面完整可用：会话、审批、模型、设置、文件和终端。它还为 dsh 加上了手机布局，并附带一个安卓 App。

- **所有机器：** 在 dsh 侧边栏里切换。看到的就是远端 dsh 自己的界面，所有功能都能用。
- **两种连接方式：** Tailscale，或你自己部署的中继服务器。一台机器可以同时使用两种。
- **不可信中继：** 中继只转发端到端加密的数据，读不到内容，也无法加入你的网络。
- **手机布局：** 抽屉式侧边栏，输入框固定在底部，适配安全区，支持浅色和深色。
- **安卓 App：** 完整的 dsh 界面，在需要审批、提问或任务完成时通知你。
- **自托管：** 无需账号，没有遥测，不依赖推送服务。

## 快速开始

### 前置条件

- DeepSeek Harness `0.2.0-rc.2`
- 所有设备登录同一个 [Tailscale](https://tailscale.com) 账号，或者有一台自建的中继服务器

### 插件

在每台机器上安装，然后重启 dsh：

```bash
dsh plugin --profile web add kivotos
```

桌面版需要先退出 App，再用它自带的 CLI 安装：

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add kivotos
```

其它机器会出现在侧边栏底部的 **机器** 里。

### 手机

从[发布页](https://github.com/Rinai-R/kivotos/releases)下载 APK 安装。在电脑上打开 **机器 → 配对手机**，用 App 扫码。

### 中继

在一台有公网地址的服务器上运行中继：

```bash
docker build -t kivotos-relay packages/relay
docker run -d --name kivotos-relay -p 7443:7443 -v kivotos-relay:/data kivotos-relay
```

在第一台电脑上打开 **设置 → 远程连接 → 自建中继**，填写中继地址并创建网络，再按页面显示的命令在中继上登记。其它电脑和手机用邀请链接或二维码加入。

拿到邀请链接的人，或登录了你 Tailscale 账号的人，都能完全控制你的机器。

## 开发

- `packages/kivotos`：dsh 插件（TypeScript）
- `packages/mobile`：安卓 App（Expo、Kotlin）
- `packages/relay`：中继服务器（Go）

```bash
npm install          # install tools and build the plugin
npm run build        # rebuild the plugin after changing src/
npm run typecheck
npm test

npm run apk -w packages/mobile     # Android APK (JDK 17, Android SDK)
cd packages/relay && go test ./...
```

架构和约定见 [AGENTS.md](AGENTS.md)，报告漏洞见 [SECURITY.md](SECURITY.md)。

## 许可证

Apache-2.0。Kivotos 与 DeepSeek 和 Tailscale 均无关联。
