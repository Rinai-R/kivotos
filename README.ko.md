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

Kivotos는 DeepSeek Harness(dsh)용 플러그인입니다. Tailscale tailnet에서 Kivotos를 실행 중인 모든 dsh를 다른 dsh에서 dsh 본래의 전체 UI 그대로 열고 조작할 수 있습니다. 또한 dsh에 완전한 휴대폰 레이아웃을 추가하고, 세션에 당신이 필요할 때 알려 주는 Android 앱도 함께 제공합니다. Kivotos 자체에는 UI가 없으며, 표시되는 화면은 모두 dsh의 UI입니다.

## 기능

- **Tailscale을 통한 페더레이션**: 어떤 dsh에서든 같은 tailnet에서 Kivotos를 실행 중인 다른 dsh의 UI를 그대로 열 수 있습니다. 원격 dsh 자신의 UI를 리버스 프록시로 제공하는 방식이므로 재구현이 아니며, 다음 기능이 모두 동작합니다.
  - 세션 생성, 삭제, 보관
  - 승인 및 사용자 질문
  - 모델 목록 조회 및 전환
  - 설정
  - 워크스페이스 파일
  - 터미널
- **머신 전환기**: dsh 사이드바 하단(Settings 위)에 "이 머신"과 제공 호스트가 마운트한 피어 목록을 표시합니다. 클릭하면 `/` 또는 `/kivotos/peer/<id>/`로 이동합니다.
- **휴대폰 레이아웃**: 너비 768px 미만이면서 Kivotos 앱 안이거나 터치 중심 기기일 때 적용됩니다(폭을 줄인 데스크톱 창은 dsh 본래 레이아웃을 유지합니다).
  - 단일 열 레이아웃. 사이드바는 슬라이드인 드로어(`min(86vw, 320px)`)가 되며, 어둡게 처리된 배경을 누르면 닫힙니다.
  - 대화 제목 앞에 드로어 토글 버튼을 배치합니다.
  - 입력창(dsh 자체의 sticky 컴포저)을 화면 하단에 고정하고 safe-area 여백을 확보합니다. `viewport-fit=cover`를 사용합니다.
  - 입력 요소는 16px로, iOS 자동 확대를 방지합니다.
  - dsh 테마 토큰만 사용하며 라이트와 다크 테마를 모두 지원합니다.
- **Android 앱**: 각 머신의 전체 dsh UI를 열고, 당신이 그 세션을 보고 있지 않을 때 세션이 승인을 필요로 하거나 질문을 하거나 작업을 완료하면 시스템 알림과 팝업으로 알려 줍니다. 알림을 탭하면 해당 세션이 열립니다.

## 요구 사항

- Node `^22.19.0 || >=24`
- dsh 0.2.0-rc.2
- 각 머신에서 Tailscale에 로그인되어 있을 것

## 설치

각 머신에서 공개된 패키지를 npm으로 설치합니다.

```sh
dsh plugin --profile web add kivotos
```

설치 후 dsh를 재시작합니다. Kivotos를 사용할 모든 머신에서 같은 절차를 반복하세요.

소스에서 실행하려면(개발용) 플러그인을 빌드한 뒤 해당 디렉터리를 추가합니다.

```sh
git clone git@github.com:Rinai-R/kivotos.git
cd kivotos
npm install   # 빌드 도구를 설치하고 packages/kivotos/dist/를 빌드합니다
dsh plugin --profile web add "$PWD/packages/kivotos"
```

다음 명령의 출력에 `kivotos` 항목이 있으면 설치가 완료된 것입니다.

```sh
dsh --profile web --dump-config
```

DeepSeek Harness 데스크톱 앱은 `desktop` 프로필을 사용합니다. 앱을 완전히 종료한 뒤 앱에 포함된 CLI로 설치하고(일반 `dsh`는 `desktop` 프로필을 거부합니다) 앱을 다시 여세요.

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add kivotos
```

동시에 실행하는 프로필 중 하나에만 Kivotos를 설치하세요. 모든 Kivotos가 7380 포트에서 수신합니다.

## 사용법

### 컴퓨터에서 사용하기

dsh 사이드바 하단(Settings 위)의 머신 전환기에서 다른 머신을 선택합니다. 해당 머신의 dsh UI가 `/kivotos/peer/<id>/`에서 열립니다. 머신 목록은 항상 현재 열려 있는 제공 호스트에서 가져옵니다.

### 휴대폰에서 사용하기

#### Android 앱

1. 휴대폰에 Tailscale 앱을 설치하고 컴퓨터와 같은 tailnet 계정으로 로그인합니다.
2. 최신 [GitHub Release](https://github.com/Rinai-R/kivotos/releases)에서 `Kivotos-v*.apk`를 내려받아 설치합니다. 아직 출시되지 않은 빌드는 GitHub Actions의 `kivotos-android`에서 내려받거나 직접 빌드합니다("개발" 참고).
3. 컴퓨터에서 Kivotos가 설치된 dsh를 계속 실행합니다. 사이드바의 머신 전환 메뉴에서 **휴대폰 페어링**을 눌러 QR 코드를 표시하고, 휴대폰 앱에서 **코드 스캔**을 눌러 읽습니다. 앱이 컴퓨터의 응답과 휴대폰의 접근 권한을 확인합니다. 컴퓨터마다 한 번씩 진행합니다. 스캔할 수 없다면 휴대폰 자신의 주소가 아닌 **컴퓨터의** Tailscale IP와 포트를 직접 입력할 수 있습니다.
4. **알림**을 켭니다. Android가 권한을 요청하면 허용하고, 앱이 안내하면 Kivotos의 백그라운드 실행을 허용하세요. 그렇지 않으면 시스템이 배터리 절약을 위해 알림을 중지할 수 있습니다.
5. 머신을 탭하면 해당 머신의 전체 dsh UI가 열립니다.

알림이 켜져 있는 동안 앱은 머신마다 연결 하나를 열어 둡니다(Android는 이를 위해 "N개 머신 모니터링 중"이라는 상시 알림을 표시합니다). 다음 경우에 팝업이 있는 시스템 알림을 받습니다.

- 승인이 필요할 때(알림에 실행하려는 내용이 표시됩니다)
- 질문을 받았을 때
- 작업이 완료되거나 실패했을 때

앱에서 현재 보고 있는 세션에 대해서는 알림이 표시되지 않습니다. 세션을 열면 그 알림이 지워지고, 승인이나 질문이 어디서든 처리되면 해당 알림은 철회됩니다. 알림을 탭하면 그 머신의 그 세션에서 앱이 열립니다. 앱이 다른 화면을 열어 둔 동안에는 같은 이벤트가 앱 내 배너로도 표시됩니다.

앱은 Android 전용이며 Expo(React Native)로 빌드되었습니다. dsh 화면은 WebView 안의 dsh 자체 UI입니다. 알림은 각 컴퓨터의 Kivotos에서 오는 것이며 푸시 서비스가 아니므로 Google 서비스가 필요하지 않습니다.

QR 코드에는 컴퓨터의 tailnet 연결 주소만 들어 있으며 로그인 토큰은 없습니다. Android의 Tailscale 앱은 Kivotos에 기기 목록을 제공하지 않습니다. 한 번 스캔한 컴퓨터는 Kivotos가 기억합니다.

#### 브라우저

컴퓨터의 tailnet 리스너는 휴대폰 브라우저에서도 열 수 있습니다.

- `http://<computer's tailscale IP>:7380/`
- 또는 tailnet에서 HTTPS 인증서를 활성화한 경우 `https://<name>.<tailnet>.ts.net:7380/`

그 페이지의 머신 전환기에서 다른 머신으로도 이동할 수 있습니다. 브라우저에는 알림이 오지 않습니다.

두 경우 모두 토큰도 로그인도 필요 없습니다. tailnet ID가 곧 로그인입니다.

Tailscale 위의 일반 HTTP 통신은 WireGuard로 암호화되지만, 브라우저는 해당 페이지를 보안 컨텍스트로 취급하지 않습니다. 따라서 클립보드 등 일부 브라우저 API를 사용할 수 없을 수 있습니다. tailnet에서 HTTPS 인증서를 활성화하면 해결됩니다. 방법은 [Tailscale HTTPS 인증서](https://tailscale.com/kb/1153/enabling-https)를 참고하세요.

앱과 휴대폰 레이아웃은 Android 15 에뮬레이터와 브라우저 390x844에서 검증되었습니다. 실제 휴대폰에서의 사용과 두 대의 물리 머신 간 사용은 아직 검증되지 않았습니다.

## 설정

설정 행의 id는 `kivotos`입니다. 재정의는 `$DSH_HOME/profiles/<profile>/cordis.patch.yml`에 작성합니다. 기본값은 다음과 같습니다.

```yaml
- id: kivotos
  config:
    port: 7380 # tailnet 리스너 포트. 모든 머신에서 같은 값을 사용
    tls: auto # auto | on | off
    discover: true # 같은 사용자의 tailnet 노드를 탐색
    refreshSeconds: 30 # 5..3600
    listen: true # 이 머신에서 tailnet 리스너를 실행
    listenHost: "" # "" = 이 노드의 Tailscale IPv4
    allowSelf: false # 이 노드 자신의 주소에서 오는 요청을 허용(테스트 환경 전용)
    tailscale: tailscale # CLI 경로
    staticPeers: [] # [{ id, name, host, port, tls?, servername? }]
    trace: requests # off | requests | frames
```

일치하는 재정의는 `config` 객체 전체를 대체합니다.

`tls` 값의 의미:

- `auto`(기본값): tailnet에서 HTTPS 인증서가 활성화된 경우 HTTPS를 사용합니다. 인증서는 `tailscale cert`로 `$DSH_HOME/kivotos/tls/`에 발급합니다.
- `on`: HTTPS를 필수로 합니다.
- `off`: HTTPS를 사용하지 않습니다.

Kivotos는 `tailscale serve`를 실행하지 않으며 Tailscale 설정도 변경하지 않습니다.

## 추적 로그

Kivotos는 휴대폰과 다른 머신에 어떻게 응답했는지를 한 줄에 JSON 객체 하나씩 `$DSH_HOME/kivotos/logs/trace-YYYY-MM-DD.jsonl`(기본값 `~/.dsh/kivotos/logs/`)에 기록합니다. 7일이 지난 파일은 삭제되고, 하루 파일은 50 MB에서 멈춥니다. 경로는 쿼리 문자열 없이 기록됩니다.

| `event`                            | 기록 내용                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http`                             | tailnet 리스너로 들어온 각 요청: 클라이언트 IP와 노드, 허용 판단 시간(`admitMs`, `cached`는 `tailscale whois`를 건너뛰었는지 여부), 상태 코드, 첫 바이트까지의 시간(`ttfbMs`), 전체 시간(`totalMs`), 송수신 바이트 수, `content-encoding`, `cache-control` |
| `ws.open`, `ws`                    | 각 WebSocket(dsh의 `remote.mux`): 핸드셰이크 시간, 지속 시간, 송수신 바이트 수                                                                                                                                                                             |
| `ws.frame`                         | `trace: frames`일 때만: 각 WebSocket 프레임의 방향, 크기, 연결 후 경과 밀리초                                                                                                                                                                              |
| `client`                           | 휴대폰 페이지가 직접 보고: 내비게이션 단계, 휴대폰에서 본 각 리소스의 시간·첫 바이트까지의 시간·크기, dsh 프레임이 처음 렌더링된 시각(`shellReadyMs`)                                                                                                      |
| `sse.open`, `sse.close`            | Android 앱의 알림 스트림                                                                                                                                                                                                                                   |
| `peer.http`, `peer.ws`             | 이 dsh가 다른 머신으로 전달하는 요청                                                                                                                                                                                                                       |
| `login`, `probe`, `listener.start` | 루프백 로그인, 피어 탐색, 리스너 시작                                                                                                                                                                                                                      |

세션 로딩이 느린 원인을 찾을 때는 `trace: frames`를 사용하세요. dsh UI가 WebSocket으로 보내는 각 요청과 응답이 돌아가는 시각을 볼 수 있습니다. 설정 행에서 켜고 dsh를 재시작해 재현한 뒤 그날의 파일을 확인하세요.

## 보안

**당신의 tailnet 계정에 로그인한 사람은 누구나 그 계정에서 Kivotos를 실행 중인 모든 dsh를 완전히 제어할 수 있습니다.** 이는 그 컴퓨터 앞에 앉아 있는 것과 같습니다. 명령 실행, 파일 읽기와 쓰기, 터미널 사용, 도구 호출 승인이 모두 가능합니다. 확인하는 것은 Tailscale ID뿐이며 2차 인증은 없습니다. tailnet 계정을 안전하게 유지하고 공유하지 마세요.

tailnet 리스너는 다음 조건을 모두 만족하는 요청만 받아들입니다.

- `Host` 헤더가 이 노드(Tailscale IP 또는 MagicDNS 이름)를 가리킬 것. DNS 리바인딩 방어이며, 만족하지 않으면 421을 반환합니다.
- 크로스 사이트 요청이 아닐 것. `Sec-Fetch-Site: cross-site`가 없고, `Origin`이 있으면 요청 authority와 일치해야 합니다. 만족하지 않으면 403을 반환합니다.
- 접속 원본 주소의 `tailscale whois`가 이 노드와 **같은 tailnet 사용자**에 속할 것. 만족하지 않으면 403을 반환합니다. 기기 공유, 공유 tailnet의 다른 사용자, 태그된 기기(사용자 없음)는 거부됩니다.
- 기본적으로 이 노드 자신의 주소에서 온 요청이 아닐 것(`allowSelf: false`).

tailnet 리스너는 Tailscale 주소에만 바인딩하며 `0.0.0.0`이나 LAN에는 노출하지 않습니다. 피어 마운트는 dsh 자체의 연결 펜스(dsh 로그인 쿠키와 Host/Origin 검사) 뒤에 있습니다.

취약점 신고 방법은 [SECURITY.md](SECURITY.md)를 참고하세요.

## 동작 방식

- Kivotos를 실행하는 각 dsh는 **Tailscale 주소에서만** 두 번째 HTTP 리스너(tailnet 리스너, 기본 포트 7380)를 엽니다. dsh 본체는 루프백에 그대로 있습니다. 받아들인 요청은 Kivotos가 프로세스 내부에서 얻은 dsh 로그인 쿠키를 붙여 루프백 dsh로 전달됩니다. 이 쿠키는 브라우저에 전달되지 않습니다.
- 제공 측 dsh는 발견한 각 피어를 `/kivotos/peer/<id>/`에 마운트합니다. 마운트는 dsh 자체의 연결 펜스 뒤에 있으며 피어의 tailnet 리스너로 전달합니다. 피어 페이지에는 피어별 `localStorage` 네임스페이스(`kivotos:<id>:`)가 주입되므로 각 피어의 클라이언트 상태가 서로 덮어쓰지 않습니다.
- 피어 탐색은 `refreshSeconds`마다 수행됩니다. `tailscale status --json`에서 같은 tailnet 사용자의 온라인 노드를 가져오고, `port`의 `GET /kivotos/hello`에 응답한 노드를 마운트합니다. 설정의 `staticPeers`도 추가됩니다.
- 홉은 연쇄되지 않습니다. `/kivotos/peer/b/kivotos/peer/a/`와 같은 다단 경로는 508로 거부됩니다.

## 호환성

Kivotos는 **dsh 0.2.0-rc.2에 고정**되어 있습니다. dsh에는 휴대폰 레이아웃이 없고 프레임 그리드를 담당하는 슬롯도 없기 때문에, 휴대폰 스타일시트는 dsh 0.2.0-rc.2의 내부 구조(CSS 모듈 클래스 이름 접미사와 data 속성)에 의존합니다. 이는 "다른 플러그인의 DOM이나 스타일시트를 읽지 않는다"는 dsh 플러그인 규칙을 의도적으로 어기는 것입니다. index HTML 재작성(viewport 메타, manifest 링크)도 0.2.0-rc.2 마크업과 정확히 일치해야 하며, 마크업이 바뀌면 아무 동작 없이 무효가 됩니다. dsh를 업그레이드할 때마다 동작을 다시 확인하세요.

그 외의 부분은 dsh 플러그인 규칙을 따릅니다.

## 개발

소스는 `packages/kivotos/src/`의 TypeScript이며 esbuild로 `dist/`에 빌드하고, dsh는 `dist/`를 불러옵니다. 런타임 의존성은 없습니다.

```sh
npm run build          # esbuild: src/ -> dist/ (npm install 시에도 실행)
npm run typecheck      # tsc --noEmit
npm run lint           # oxlint
npm run format         # oxfmt
npm run format:check   # oxfmt
npm test               # TypeScript 소스에서 node --test 실행
```

`src/`를 변경한 뒤에는 `npm run build`를 실행하고 dsh를 다시 시작하세요.

lefthook pre-commit 훅이 포맷 검사, lint, 타입 검사를 실행합니다.

테스트 팁: 한 머신에서 두 개의 dsh 인스턴스를 실행하고, 각각 서로 다른 `port`와 `allowSelf: true`를 설정한 뒤 `staticPeers`로 서로를 등록하면 페더레이션을 시험해 볼 수 있습니다.

Android 앱은 `packages/mobile/`(Expo SDK 57, React Native)에 있습니다. 알림 서비스는 Kotlin으로 작성된 로컬 Expo 모듈 `packages/mobile/modules/kivotos-attention/`입니다. APK를 빌드하려면 JDK 17과 Android SDK(`ANDROID_HOME`)가 필요합니다.

```sh
npm install
npm run apk -w packages/mobile   # expo prebuild, 그다음 gradlew assembleRelease
# -> packages/mobile/android/app/build/outputs/apk/release/app-release.apk
```

`packages/mobile/android/`는 `expo prebuild`가 생성하며 커밋되지 않습니다. 릴리스 APK는 디버그 키로 서명되어 바로 설치할 수 있지만 앱 스토어용은 아닙니다.

버전을 출시하려면 루트, 플러그인, mobile의 각 `package.json`에 있는 `version`과 `packages/mobile/app.json`의 `expo.version`을 같은 값으로 바꾸고 Android 업그레이드를 위해 `expo.android.versionCode`를 증가시킵니다. [CHANGELOG.md](CHANGELOG.md)에 해당 버전의 섹션을 작성한 뒤(CI가 이를 GitHub Release 설명으로 게시하며 섹션이 없는 태그는 거부합니다), 해당 `v<version>` 태그(예: `v0.1.2`)를 푸시합니다. CI 검사와 APK 빌드가 성공하면 먼저 `kivotos`을 npm에 게시하고(provenance 포함) 이어서 GitHub Release에 `Kivotos-v<version>.apk`와 `Kivotos-v<version>.sha256`을 첨부합니다. 하이픈이 포함된 태그는 사전 릴리스로 게시되며 npm에서는 `next` 태그로 게시됩니다. 일반 `main` 커밋에서는 임시 Actions artifact만 생성됩니다. 게시된 APK는 여전히 Expo의 디버그 키로 서명되므로 직접 설치용이며 스토어 배포나 정식 프로덕션 서명에는 적합하지 않습니다.

```sh
git tag v0.1.2
git push origin v0.1.2
```

## 라이선스

Apache-2.0입니다. 자세한 내용은 [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 참고하세요.

Kivotos는 DeepSeek 및 Tailscale과 관련이 없습니다.
