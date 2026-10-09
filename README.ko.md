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

Kivotos는 DeepSeek Harness(dsh)용 플러그인입니다. Tailscale tailnet에서 Kivotos를 실행 중인 모든 dsh를 다른 dsh에서 dsh 본래의 전체 UI 그대로 열고 조작할 수 있습니다. 또한 dsh에 완전한 휴대폰 레이아웃을 추가합니다. Kivotos 자체에는 UI가 없으며, 표시되는 화면은 모두 dsh의 UI입니다.

## 기능

- **Tailscale을 통한 페더레이션**: 어떤 dsh에서든 같은 tailnet에서 Kivotos를 실행 중인 다른 dsh의 UI를 그대로 열 수 있습니다. 원격 dsh 자신의 UI를 리버스 프록시로 제공하는 방식이므로 재구현이 아니며, 다음 기능이 모두 동작합니다.
  - 세션 생성, 삭제, 보관
  - 승인 및 사용자 질문
  - 모델 목록 조회 및 전환
  - 설정
  - 워크스페이스 파일
  - 터미널
- **머신 전환기**: dsh 사이드바 하단(Settings 위)에 "이 머신"과 제공 호스트가 마운트한 피어 목록을 표시합니다. 클릭하면 `/` 또는 `/kivotos/peer/<id>/`로 이동합니다.
- **휴대폰 레이아웃**: 너비 768px 미만에서 적용됩니다.
  - 단일 열 레이아웃. 사이드바는 슬라이드인 드로어(`min(86vw, 320px)`)가 되며, 어둡게 처리된 배경을 누르면 닫힙니다.
  - 대화 제목 앞에 드로어 토글 버튼을 배치합니다.
  - 입력창(dsh 자체의 sticky 컴포저)을 화면 하단에 고정하고 safe-area 여백을 확보합니다. `viewport-fit=cover`를 사용합니다.
  - 입력 요소는 16px로, iOS 자동 확대를 방지합니다.
  - dsh 테마 토큰만 사용하며 라이트와 다크 테마를 모두 지원합니다.

## 요구 사항

- Node `^22.19.0 || >=24`
- dsh 0.2.1-alpha.1
- 각 머신에서 Tailscale에 로그인되어 있을 것

## 설치

```sh
git clone git@github.com:Rinai-R/kivotos.git
dsh plugin --profile web add /absolute/path/to/kivotos/packages/kivotos
```

설치 후 dsh를 재시작합니다. Kivotos를 사용할 모든 머신에서 같은 절차를 반복하세요.

다음 명령의 출력에 `kivotos` 항목이 있으면 설치가 완료된 것입니다.

```sh
dsh --profile web --dump-config
```

데스크톱 앱 프로필은 `desktop`이지만 동작은 아직 검증되지 않았습니다.

## 사용법

### 컴퓨터에서 사용하기

dsh 사이드바 하단(Settings 위)의 머신 전환기에서 다른 머신을 선택합니다. 해당 머신의 dsh UI가 `/kivotos/peer/<id>/`에서 열립니다. 머신 목록은 항상 현재 열려 있는 제공 호스트에서 가져옵니다.

### 휴대폰에서 사용하기

1. 휴대폰에 Tailscale 앱을 설치하고 **같은 tailnet 계정**으로 로그인합니다.
2. 브라우저에서 `http://<컴퓨터의 Tailscale IP>:7380/`을 엽니다. tailnet에서 HTTPS 인증서를 활성화했다면 `https://<name>.<tailnet>.ts.net:7380/`을 사용합니다.
3. 토큰이나 로그인은 필요 없습니다. tailnet ID가 곧 로그인입니다.
4. 그 페이지의 머신 전환기에서 다른 머신으로도 이동할 수 있습니다.

HTTP와 HTTPS의 차이: Tailscale 위의 일반 HTTP 통신은 WireGuard로 암호화되지만, 브라우저는 해당 페이지를 보안 컨텍스트로 취급하지 않습니다. 따라서 클립보드 등 일부 브라우저 API를 사용할 수 없을 수 있습니다. Tailscale 관리 콘솔에서 HTTPS 인증서를 활성화하면 해결됩니다. 방법은 [Tailscale 문서](https://tailscale.com/kb/1153/enabling-https)를 참고하세요.

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
```

일치하는 재정의는 `config` 객체 전체를 대체합니다.

`tls` 값의 의미:

- `auto`(기본값): tailnet에서 HTTPS 인증서가 활성화된 경우 HTTPS를 사용합니다. 인증서는 `tailscale cert`로 `$DSH_HOME/kivotos/tls/`에 발급합니다.
- `on`: HTTPS를 필수로 합니다.
- `off`: HTTPS를 사용하지 않습니다.

Kivotos는 `tailscale serve`를 실행하지 않으며 Tailscale 설정도 변경하지 않습니다.

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

Kivotos는 **dsh 0.2.1-alpha.1에 고정**되어 있습니다. dsh에는 휴대폰 레이아웃이 없고 프레임 그리드를 담당하는 슬롯도 없기 때문에, 휴대폰 스타일시트는 dsh 0.2.1-alpha.1의 내부 구조(CSS 모듈 클래스 이름 접미사와 data 속성)에 의존합니다. 이는 "다른 플러그인의 DOM이나 스타일시트를 읽지 않는다"는 dsh 플러그인 규칙을 의도적으로 어기는 것입니다. index HTML 재작성(viewport 메타, manifest 링크)도 0.2.1-alpha.1 마크업과 정확히 일치해야 하며, 마크업이 바뀌면 아무 동작 없이 무효가 됩니다. dsh를 업그레이드할 때마다 동작을 다시 확인하세요.

그 외의 부분은 dsh 플러그인 규칙을 따릅니다.

## 개발

순수 ESM JavaScript이며 빌드 단계나 런타임 의존성이 없습니다. 소스는 `packages/kivotos/`에 있습니다.

```sh
npm run typecheck      # tsc --checkJs
npm run lint           # oxlint
npm run format         # oxfmt
npm run format:check   # oxfmt
npm run build          # node --check
npm test               # node --test
```

lefthook pre-commit 훅이 포맷 검사, lint, 타입 검사를 실행합니다.

테스트 팁: 한 머신에서 두 개의 dsh 인스턴스를 실행하고, 각각 서로 다른 `port`와 `allowSelf: true`를 설정한 뒤 `staticPeers`로 서로를 등록하면 페더레이션을 시험해 볼 수 있습니다.

## 라이선스

Apache-2.0입니다. 자세한 내용은 [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 참고하세요.

Kivotos는 DeepSeek 및 Tailscale과 관련이 없습니다.
