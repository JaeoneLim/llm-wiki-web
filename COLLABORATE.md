# 협업자에게 챗 위키 열어주기 (Cloudflare Tunnel + Access)

허용한 협업자가 **챗 UI에서 PDF·대화로 위키를 구축**하게 하되, 그 AI는 **내
Claude Code 구독**이 구동하는 구성이다. 핵심: 정적 호스팅은 Claude Code를 못
돌리므로, **백엔드를 내 머신에서 실행**하고 **Cloudflare Tunnel**로 노출한 뒤
**Cloudflare Access(이메일 PIN)** 로 협업자를 게이팅한다.

```
협업자 브라우저 ──HTTPS──▶ Cloudflare Access(이메일 PIN) ──Tunnel──▶ 내 머신:3001
                                                              └ Fastify 한 포트:
                                                                 / (챗 UI) · /api · /wiki(Quartz)
                                                                 └ 내 Claude Code(구독)가 위키 작성
```

> ⚠️ **약관 주의**: Anthropic 개인용 구독(Pro/Max)은 본래 개인 사용 용도다.
> 협업자 여러 명의 작업을 내 구독으로 처리하는 것은 약관 회색지대이며 Anthropic이
> third-party 사용을 단속 중이다(2026). 소규모·신뢰 범위에서 본인 책임으로 사용하고,
> 규모가 커지면 API 키(종량제) 방식으로 전환하는 것을 권장한다.

## 1. 내 머신에서 프로덕션 서버 실행

Claude Code가 로그인된 머신(또는 항상 켜두는 홈서버)에서:

```bash
npm run serve
```

- `build:all`(챗 web + Quartz)을 거쳐 **단일 포트(기본 :3001)** 에서
  `/`(챗 UI) · `/api` · `/wiki`(위키)를 모두 서빙한다.
- 협업자가 위키를 만들면 파일 변경을 감지해 **~2.5초 뒤 `/wiki`가 자동 갱신**된다.
- 포트 변경: `API_PORT=8000 npm run serve`.
- 상시 실행: `tmux`/`screen`, 또는 systemd 서비스/`pm2`로 백그라운드 유지.

## 2. Cloudflare Tunnel로 노출

### (a) 빠른 테스트 — 도메인 불필요
```bash
cloudflared tunnel --url http://localhost:3001
```
임시 `https://<랜덤>.trycloudflare.com` URL이 발급된다. 동작 확인용(Access는 안 붙음).

### (b) 실제 — Cloudflare 관리 도메인 필요
```bash
cloudflared tunnel login
cloudflared tunnel create wiki-chat
# ~/.cloudflared/config.yml:
#   tunnel: <TUNNEL_ID>
#   credentials-file: /home/<user>/.cloudflared/<TUNNEL_ID>.json
#   ingress:
#     - hostname: wiki.example.com
#       service: http://localhost:3001
#     - service: http_status:404
cloudflared tunnel route dns wiki-chat wiki.example.com
cloudflared tunnel run wiki-chat
```
포트 개방·고정 IP 불필요. `wiki.example.com`이 내 머신의 :3001로 연결된다.

## 3. Cloudflare Access로 잠그기 (이메일 PIN)

market-wiki와 동일한 Zero-Trust 흐름이다.

1. Cloudflare 대시보드 → **Zero Trust** → **Access → Applications → Add an
   application → Self-hosted**
2. Application domain: `wiki.example.com`, Session duration: 적당히(예: 24h~1주)
3. **Identity providers**: **One-time PIN**(이메일 OTP) 활성화
4. **Policies → Add policy**: Action **Allow** → Include → **Emails** →
   협업자 이메일들 나열 (또는 도메인 단위 `@mycompany.com`)
5. 저장

이제 협업자는 `https://wiki.example.com` 접속 → 이메일 입력 → OTP → 챗 UI 진입.
백엔드는 `Cf-Access-Authenticated-User-Email` 헤더를 받아 **누가 작업했는지 서버
로그에 귀속**한다.

## 4. (선택) git 동기화 + 공개 읽기전용 미러

```bash
GIT_SYNC=1 npm run serve
```
- 위키 변경 시 디바운스로 `git add/commit/push`(위키 콘텐츠만; `raw/`·`config.json`은
  gitignore). **사전 조건**: 레포가 git 저장소 + remote 설정(`git init`, `git remote add`).
- push가 GitHub로 가면 [`DEPLOY.md`](./DEPLOY.md)의 **Cloudflare Pages**가 읽기전용
  공개 위키를 자동 리빌드 — 챗에 들어오지 않는 사람에게 결과만 보여줄 때 유용.

## 동시성·한계

- 협업자별 챗 세션은 `sessionId`로 분리된다. 다만 모두 **같은 위키 파일**을 쓰므로,
  여러 명이 동시에 같은 페이지를 ingest하면 충돌 가능(소규모에선 위험 낮음).
  필요하면 작업 시간대를 나누거나 ingest를 직렬화한다.
- 백엔드는 내 머신에서 돌아가므로 **머신이 꺼지면 중단**된다. 상시성이 중요하면
  홈서버/미니PC에 Claude Code를 로그인해두고 거기서 `npm run serve`.

## 트러블슈팅

- **`/wiki`가 비어 보임**: `npm run serve`가 `build:all`을 끝냈는지 확인(첫 빌드 몇 초).
- **자동 갱신 안 됨**: 서버 로그에 `[wiki] 리빌드 완료` 확인. Node ≥22 필요(recursive watch).
- **협업자 접근 차단/허용 안 됨**: Access 정책의 이메일 목록·도메인 확인. OTP 메일은 스팸함 확인.
- **구독이 아니라 API로 청구됨**: `~/.claude` 로그인 상태 확인(`claude` CLI로 로그인). 환경에
  `ANTHROPIC_API_KEY`가 있으면 그게 우선될 수 있으니 unset.
