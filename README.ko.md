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

<p align="center">어느 컴퓨터나 휴대폰에서든, 내 모든 DeepSeek Harness를.</p>

Kivotos는 DeepSeek Harness(dsh)용 오픈 소스 플러그인입니다. 한 머신에서 다른 머신의 dsh를 완전한 UI 그대로 열 수 있습니다. 세션, 승인, 모델, 설정, 파일, 터미널을 모두 사용할 수 있습니다. dsh에 휴대폰 레이아웃을 추가하며 Android 앱도 함께 제공합니다.

- **모든 머신:** dsh 사이드바에서 전환합니다. 보이는 것은 원격 dsh 자체의 UI이므로 모든 기능이 동작합니다.
- **두 가지 연결 방식:** Tailscale 또는 직접 운영하는 릴레이 서버. 한 머신에서 둘을 동시에 쓸 수 있습니다.
- **신뢰하지 않는 릴레이:** 릴레이는 종단 간 암호화된 데이터를 전달만 하며, 내용을 읽거나 네트워크에 참여할 수 없습니다.
- **휴대폰 레이아웃:** 드로어 사이드바, 하단에 고정된 입력창, safe area 대응, 라이트와 다크.
- **Android 앱:** 완전한 dsh UI와 승인·질문·작업 완료 알림.
- **셀프 호스팅:** 계정 없음, 텔레메트리 없음, 푸시 서비스 없음.

## 시작하기

### 사전 요구 사항

- DeepSeek Harness `0.2.0-rc.2`
- 모든 기기가 같은 [Tailscale](https://tailscale.com) 계정에 로그인되어 있거나, 직접 운영하는 릴레이 서버

### 플러그인

각 머신에 설치합니다. dsh에서 **Plugins → Install a third-party plugin**을 열고 `kivotos`를 입력합니다. 터미널에서도 설치할 수 있습니다.

```bash
dsh plugin --profile web add kivotos
```

dsh를 다시 시작하면 다른 머신은 사이드바 하단의 **Machines**에 표시됩니다.

### 휴대폰

[릴리스 페이지](https://github.com/Rinai-R/kivotos/releases)에서 APK를 설치합니다. 컴퓨터에서 **Machines → Pair phone**을 열고 앱으로 코드를 스캔합니다.

### 릴레이

공인 주소가 있는 서버에서 릴레이를 실행합니다.

```bash
docker build -t kivotos-relay packages/relay
docker run -d --name kivotos-relay -p 7443:7443 -v kivotos-relay:/data kivotos-relay
```

첫 번째 컴퓨터에서 **Settings → Remote access → Own relay**를 열어 릴레이 주소를 입력하고 네트워크를 만든 다음, 페이지에 표시되는 명령으로 릴레이에 등록합니다. 다른 컴퓨터와 휴대폰은 초대 링크나 QR 코드로 참여합니다.

초대 링크를 가진 사람이나 내 Tailscale 계정에 로그인한 사람은 내 머신을 완전히 제어할 수 있습니다.

## 개발

- `packages/kivotos`: dsh 플러그인(TypeScript)
- `packages/mobile`: Android 앱(Expo, Kotlin)
- `packages/relay`: 릴레이 서버(Go)

```bash
npm install          # install tools and build the plugin
npm run build        # rebuild the plugin after changing src/
npm run typecheck
npm test

npm run apk -w packages/mobile     # Android APK (JDK 17, Android SDK)
cd packages/relay && go test ./...
```

아키텍처와 규칙은 [AGENTS.md](AGENTS.md), 취약점 신고는 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

Apache-2.0. Kivotos는 DeepSeek 및 Tailscale과 관련이 없습니다.
