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

<p align="center">どのコンピューターやスマートフォンからでも、すべての DeepSeek Harness を。</p>

Kivotos は DeepSeek Harness（dsh）のオープンソースプラグインです。あるマシンから別のマシンの dsh を、完全な UI のまま開けます。セッション、承認、モデル、設定、ファイル、ターミナルがすべて使えます。dsh にスマートフォン向けレイアウトを追加し、Android アプリも付属します。

- **すべてのマシン:** dsh のサイドバーから切り替えます。表示されるのはリモートの dsh 自身の UI なので、すべての機能が動きます。
- **2 つの接続方法:** Tailscale、または自分で運用するリレーサーバー。1 台で両方を同時に使えます。
- **信頼しないリレー:** リレーはエンドツーエンドで暗号化されたデータを転送するだけで、内容を読むこともネットワークに参加することもできません。
- **スマートフォンレイアウト:** ドロワー式サイドバー、下部に固定された入力欄、セーフエリア対応、ライトとダーク。
- **Android アプリ:** 完全な dsh の UI と、承認・質問・タスク完了の通知。
- **セルフホスト:** アカウント不要、テレメトリなし、プッシュサービスなし。

## はじめに

### 前提条件

- DeepSeek Harness `0.2.0-rc.2`
- すべてのデバイスで同じ [Tailscale](https://tailscale.com) アカウントにサインインしていること、または自前のリレーサーバー

### プラグイン

各マシンにインストールして dsh を再起動します。

```bash
dsh plugin --profile web add kivotos
```

デスクトップアプリの場合は、アプリを終了してから同梱の CLI を使います。

```bash
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add kivotos
```

ほかのマシンはサイドバー下部の **Machines** に表示されます。

### スマートフォン

[リリースページ](https://github.com/Rinai-R/kivotos/releases)から APK をインストールします。コンピューターで **Machines → Pair phone** を開き、アプリでコードを読み取ります。

### リレー

公開アドレスを持つサーバーでリレーを実行します。

```bash
docker build -t kivotos-relay packages/relay
docker run -d --name kivotos-relay -p 7443:7443 -v kivotos-relay:/data kivotos-relay
```

最初のコンピューターで **Settings → Remote access → Own relay** を開き、リレーのアドレスを入力してネットワークを作成し、ページに表示されるコマンドでリレーに登録します。ほかのコンピューターとスマートフォンは招待リンクまたは QR コードで参加します。

招待リンクを持つ人、またはあなたの Tailscale アカウントにサインインしている人は、あなたのマシンを完全に操作できます。

## 開発

- `packages/kivotos`: dsh プラグイン（TypeScript）
- `packages/mobile`: Android アプリ（Expo、Kotlin）
- `packages/relay`: リレーサーバー（Go）

```bash
npm install          # install tools and build the plugin
npm run build        # rebuild the plugin after changing src/
npm run typecheck
npm test

npm run apk -w packages/mobile     # Android APK (JDK 17, Android SDK)
cd packages/relay && go test ./...
```

アーキテクチャと規約は [AGENTS.md](AGENTS.md)、脆弱性の報告は [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

Apache-2.0。Kivotos は DeepSeek および Tailscale とは関係ありません。
