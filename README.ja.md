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

Kivotos は DeepSeek Harness (dsh) のプラグインです。Tailscale の tailnet 上で Kivotos を動かしている任意の dsh を、別の dsh から dsh 本来の完全な UI のまま開いて操作できます。あわせて、dsh にスマートフォン向けの完全なレイアウトを追加します。Kivotos 自身は独自の UI を持たず、表示される画面はすべて dsh の UI です。

## 機能

- **Tailscale 経由のフェデレーション**: 任意の dsh から、同じ tailnet 上で Kivotos を動かしている他の dsh の UI をそのまま開けます。リモート側の dsh 自身の UI をリバースプロキシ経由で配信しているため、再実装ではなく、次の操作がすべて動作します。
  - セッションの作成・削除・アーカイブ
  - 承認とユーザーへの質問
  - モデルの一覧表示と切り替え
  - 設定
  - ワークスペースのファイル
  - ターミナル
- **マシン切り替え**: dsh のサイドバー下部(Settings の上)に、「このマシン」と、配信元ホストがマウントしているピアの一覧を表示します。クリックすると `/` または `/kivotos/peer/<id>/` に移動します。
- **スマートフォンレイアウト**: 幅 768px 未満で適用されます。
  - 1 カラム表示。サイドバーはスライドインするドロワー(`min(86vw, 320px)`)になり、背景を暗くするバックドロップをタップすると閉じます。
  - 会話タイトルの前にドロワー切り替えボタンを配置します。
  - 入力欄(dsh 自身の sticky コンポーザー)を画面下部に固定し、セーフエリアの余白を確保します。`viewport-fit=cover` を使用します。
  - 入力要素は 16px で、iOS の自動ズームを防ぎます。
  - dsh のテーマトークンのみを使用し、ライトとダークの両テーマに対応します。

## 要件

- Node `^22.19.0 || >=24`
- dsh 0.2.1-alpha.1
- 各マシンで Tailscale にサインイン済みであること

## インストール

```sh
git clone git@github.com:Rinai-R/kivotos.git
dsh plugin --profile web add /absolute/path/to/kivotos/packages/kivotos
```

インストール後に dsh を再起動します。Kivotos を使うすべてのマシンで同じ手順を繰り返してください。

次のコマンドの出力に `kivotos` のエントリが含まれていれば、インストールは完了しています。

```sh
dsh --profile web --dump-config
```

デスクトップアプリのプロファイルは `desktop` ですが、動作は未検証です。

## 使い方

### コンピューターから使う

dsh のサイドバー下部(Settings の上)にあるマシン切り替えから、別のマシンを選択します。そのマシンの dsh UI が `/kivotos/peer/<id>/` で開きます。マシン一覧は常に、現在開いている配信元ホストから取得されます。

### スマートフォンから使う

1. スマートフォンに Tailscale アプリをインストールし、**同じ tailnet アカウント**でサインインします。
2. ブラウザで `http://<コンピューターの Tailscale IP>:7380/` を開きます。tailnet で HTTPS 証明書を有効にしている場合は `https://<name>.<tailnet>.ts.net:7380/` を使います。
3. トークンやログインは不要です。tailnet のアイデンティティがそのままログインになります。
4. そのページのマシン切り替えから、他のマシンにも移動できます。

HTTP と HTTPS の違い: Tailscale 上のプレーンな HTTP 通信は WireGuard で暗号化されていますが、ブラウザはそのページをセキュアコンテキストとして扱いません。そのため、クリップボードなど一部のブラウザ API が使えない場合があります。Tailscale 管理コンソールで HTTPS 証明書を有効にすると解消します。手順は [Tailscale のドキュメント](https://tailscale.com/kb/1153/enabling-https)を参照してください。

## 設定

設定行の id は `kivotos` です。上書きは `$DSH_HOME/profiles/<profile>/cordis.patch.yml` に記述します。既定値は次のとおりです。

```yaml
- id: kivotos
  config:
    port: 7380 # tailnet リスナーのポート。すべてのマシンで同じ値にする
    tls: auto # auto | on | off
    discover: true # 同じユーザーの tailnet ノードを探索する
    refreshSeconds: 30 # 5..3600
    listen: true # このマシンで tailnet リスナーを動かす
    listenHost: "" # "" = このノードの Tailscale IPv4
    allowSelf: false # このノード自身のアドレスからのリクエストを許可する(検証環境のみ)
    tailscale: tailscale # CLI のパス
    staticPeers: [] # [{ id, name, host, port, tls?, servername? }]
```

一致する上書きは、`config` オブジェクト全体を置き換えます。

`tls` の値の意味:

- `auto`(既定): tailnet で HTTPS 証明書が有効な場合に HTTPS を使います。証明書は `tailscale cert` で `$DSH_HOME/kivotos/tls/` に発行します。
- `on`: HTTPS を必須にします。
- `off`: HTTPS を使いません。

Kivotos は `tailscale serve` を実行せず、Tailscale の設定も変更しません。

## セキュリティ

**あなたの tailnet アカウントにサインインしている人は誰でも、そのアカウント上で Kivotos を動かしているすべての dsh を完全に操作できます。** これはそのコンピューターの前に座っているのと同じです。コマンドの実行、ファイルの読み書き、ターミナルの使用、ツール呼び出しの承認ができます。確認されるのは Tailscale のアイデンティティのみで、二要素目はありません。tailnet アカウントを安全に保ち、共有しないでください。

tailnet リスナーがリクエストを受け付けるのは、次の条件をすべて満たす場合のみです。

- `Host` ヘッダーがこのノード(Tailscale IP または MagicDNS 名)を指していること。DNS リバインディング対策で、満たさない場合は 421 を返します。
- クロスサイトのリクエストでないこと。`Sec-Fetch-Site: cross-site` がなく、`Origin` がある場合はリクエストのオーソリティと一致すること。満たさない場合は 403 を返します。
- 接続元アドレスの `tailscale whois` が、このノードと**同じ tailnet ユーザー**に属すること。満たさない場合は 403 を返します。デバイス共有や共有 tailnet の他のユーザー、タグ付きデバイス(ユーザーなし)は拒否されます。
- 既定では、このノード自身のアドレスからのリクエストでないこと(`allowSelf: false`)。

tailnet リスナーは Tailscale のアドレスにのみバインドし、`0.0.0.0` や LAN には公開しません。ピアのマウントは dsh 自身の接続フェンス(dsh のログイン Cookie と Host/Origin の検査)の内側にあります。

脆弱性の報告方法は [SECURITY.md](SECURITY.md) を参照してください。

## 仕組み

- Kivotos を動かす各 dsh は、**Tailscale アドレス上でのみ** 2 つ目の HTTP リスナー(tailnet リスナー、既定ポート 7380)を開きます。dsh 本体はループバックのままです。受け付けたリクエストは、Kivotos がプロセス内で取得した dsh のログイン Cookie を付けてループバックの dsh に転送されます。この Cookie はブラウザには渡りません。
- 配信元の dsh では、検出した各ピアを `/kivotos/peer/<id>/` にマウントします。マウントは dsh 自身の接続フェンスの内側にあり、ピアの tailnet リスナーへ転送します。ピアのページには、ピアごとの `localStorage` 名前空間(`kivotos:<id>:`)が注入されるため、各ピアのクライアント状態は互いに上書きされません。
- ピアの検出は `refreshSeconds` ごとに行います。`tailscale status --json` から同じ tailnet ユーザーのオンラインノードを取得し、`port` 上の `GET /kivotos/hello` に応答したノードをマウントします。設定の `staticPeers` も追加されます。
- ホップは連鎖しません。`/kivotos/peer/b/kivotos/peer/a/` のような多段の経路は 508 で拒否されます。

## 互換性

Kivotos は **dsh 0.2.1-alpha.1 に固定**されています。dsh にはスマートフォン向けレイアウトがなく、フレームのグリッドを管理するスロットもないため、スマートフォン用スタイルシートは dsh 0.2.1-alpha.1 の内部構造(CSS モジュールのクラス名サフィックスや data 属性)に依存しています。これは「他のプラグインの DOM やスタイルシートを読まない」という dsh プラグインの規則に意図的に反しています。index HTML の書き換え(viewport メタ、manifest リンク)も 0.2.1-alpha.1 のマークアップに厳密に一致させており、マークアップが変わると何もせずに無効になります。dsh をアップグレードするたびに動作を再確認してください。

それ以外の部分は dsh プラグインの規則に従っています。

## 開発

プレーンな ESM JavaScript で、ビルド手順や実行時の依存関係はありません。ソースは `packages/kivotos/` にあります。

```sh
npm run typecheck      # tsc --checkJs
npm run lint           # oxlint
npm run format         # oxfmt
npm run format:check   # oxfmt
npm run build          # node --check
npm test               # node --test
```

lefthook の pre-commit フックで、フォーマットの確認、lint、型チェックを実行します。

検証用のヒント: 1 台のマシン上で 2 つの dsh インスタンスを動かし、それぞれに異なる `port` と `allowSelf: true` を設定し、`staticPeers` で互いを登録すると、フェデレーションを試せます。

## ライセンス

Apache-2.0 です。詳細は [LICENSE](LICENSE) と [NOTICE](NOTICE) を参照してください。

Kivotos は DeepSeek および Tailscale とは関係ありません。
