# 배포 가이드 — personal access(이메일 PIN) 전용

이 위키의 **정적 렌더 결과(`public/`)만** 공개 배포한다. 챗·ingest 백엔드는
파일시스템·`claude` 바이너리·API 키가 필요하므로 **로컬에만** 두고 절대 공개
노출하지 않는다(읽기 전용 배포).

최종 목표는 **본인만 접근 가능한 비공개 배포**다. 결론부터:

> **무료로 market-wiki와 동일한 이메일 OTP/PIN 개인 접근을 원하면
> → Cloudflare Pages + Cloudflare Access 를 쓴다.** Vercel 네이티브로는 같은
> 경험이 안 되며(아래 §3), 프로덕션 보호 자체가 유료다.

---

## 1. 준비 — GitHub 레포

Cloudflare Pages는 GitHub 레포에서 빌드한다. 먼저 이 레포를 push 한다
(예: `JaeoneLim/llm-wiki-web`, private). 배포 전 `quartz.config.ts`의 `baseUrl`을
실제 도메인(예: `llm-wiki-web.pages.dev`)으로 바꾼다 — sitemap/RSS 링크에 쓰인다.

> 참고: `wiki/**` 페이지는 커밋·발행된다. `raw/**`, `app/`, `CLAUDE.md`, `ANTIGRAVITY.md` 등은
> `quartz.config.ts`의 `ignorePatterns`로 발행에서 제외된다.

## 2. Cloudflare Pages 프로젝트 생성 (권장)

1. [cloudflare.com](https://www.cloudflare.com/) 가입 → **Workers & Pages**
2. **Create application → Pages → Connect to Git** → GitHub 인증 →
   `JaeoneLim/llm-wiki-web` 선택 → **Begin setup**
3. **Build settings**:
   - Project name: `llm-wiki-web` (URL은 `llm-wiki-web.pages.dev`)
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: `npm install && npm run build`
   - Build output directory: `public`
   - Root directory: `/`
4. **Environment variables**:
   - `NODE_VERSION` = `22` (필수 — Quartz는 Node ≥22. Cloudflare 기본은 낮음)
5. **Save and Deploy** → 1~2분 후 `https://llm-wiki-web.pages.dev` 접근 가능
   (이때는 **공개 상태** — 다음 단계에서 잠근다)

## 3. Cloudflare Access로 잠그기 (이메일 PIN)

market-wiki와 동일한 흐름이다.

1. 좌측 메뉴 → **Zero Trust** (처음이면 team name 1회 등록)
2. **Access → Applications → Add an application → Self-hosted**
3. 설정:
   - Application name: `llm-wiki-web`
   - Session duration: `1 month`
   - Application domain: `llm-wiki-web.pages.dev`
4. **Identity providers**: **One-time PIN** 활성화(기본. 이메일 OTP)
5. **Policies → Add policy**:
   - Policy name: `personal-access`
   - Action: **Allow**
   - Include → **Emails** → `you@example.com` (본인 이메일로)
6. **Add application** 저장

이제 접근 시 이메일 입력 → OTP 6자리 → 통과. 한 달 쿠키 유지. 무료(50인 이하).

## 4. (선택) 커스텀 도메인

Pages 프로젝트 → **Custom domains** → 본인 도메인 연결 후, Access 정책의
Application domain도 새 도메인으로 변경.

## 5. push → 자동 배포

이후 `git push origin main` 마다 Cloudflare Pages가 자동 빌드·배포.

---

## Vercel은? (조사 결론 — 2026-05 기준)

`tech-blog-wiki`는 Vercel에 올라가 있어 같은 방식을 떠올릴 수 있으나, **Vercel
네이티브로는 무료 이메일 PIN 개인 접근이 불가**하다.

| 방법 | 플랜 | 프로덕션 도메인 보호 | 접근 방식 |
| --- | --- | --- | --- |
| Vercel Authentication | 전 플랜(무료 포함) | ❌ **무료(Hobby)는 프리뷰 URL만** 보호, 프로덕션 공개 유지 | Vercel 계정 로그인 |
| Vercel Auth + "All Deployments" | **Pro ($20/월)** | ✅ | Vercel 계정 로그인 (PIN 아님) |
| Password Protection (공유 비번) | **Pro +$150/월** 또는 Enterprise | ✅ | 공유 패스워드 |
| Trusted IPs | Enterprise | ✅(프로덕션) | IP 화이트리스트 |

공식 경고문: *"On the Hobby plan … your production domain remains publicly
accessible. To protect production domains, you need a Pro or Enterprise plan."*

따라서 Vercel을 굳이 쓰려면:
- **(a) Pro 유료** — All Deployments + Vercel Authentication. 단 접근은 *이메일
  PIN*이 아니라 Vercel 계정 로그인이다.
- **(b) Cloudflare Access를 Vercel 앞단에** — Cloudflare로 프록시되는 커스텀
  도메인(orange-cloud)으로 Vercel을 가리키고, SSL을 **Full**로, Access에
  `/.well-known/acme-challenge/*` **bypass 규칙**을 둔다. 동작은 하지만 Vercel은
  리버스 프록시를 **권장하지 않는다**(트래픽 가시성·지연·캐시 이슈).

→ 개인 비공개 목적에는 **Cloudflare Pages + Access(§2~3)** 가 무료이고 가장 깔끔하다.

### 출처
- Vercel Deployment Protection: <https://vercel.com/docs/deployment-protection>
- Vercel Authentication: <https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication>
- Cloudflare in front of Vercel: <https://vercel.com/kb/guide/cloudflare-with-vercel>

---

## 트러블슈팅

- **빌드가 Node 18 등으로 시도 / Quartz 빌드 실패**: `NODE_VERSION=22` env var 확인.
- **Pretendard/Noto 폰트 안 보임**: Google Fonts CDN 차단 네트워크일 수 있음. Cloudflare는 정상.
- **Access OTP 이메일 안 옴**: 스팸함 확인, 또는 Google OAuth로 전환.

## 면책

콘텐츠는 GitHub private repo + Cloudflare Pages에 저장된다. 완전 air-gapped는
아니다. 진정한 비공개가 필요하면 Tailscale 자체호스팅으로 전환한다.
