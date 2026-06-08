#!/usr/bin/env node
/**
 * 회사별 신뢰 프로필 정적 HTML 생성기.
 *
 * - Supabase에서 발행된(is_published=true) 회사 목록 fetch
 * - profile/index.html을 템플릿으로 복사
 * - <head>의 OG 메타를 회사별 정보로 치환
 * - profile/{slug}/index.html 생성 (200 OK + 회사별 OG)
 *
 * 기존 404.html 동적 라우팅과 공존:
 * - 정적 파일 있으면 → GitHub Pages가 200 OK + 회사별 OG 응답
 * - 없으면 → 404.html이 잡아서 동적 라우팅 (신규 회사 자동 fallback)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SB_URL = 'https://iucicugxihxilcqtzrbk.supabase.co';
const SB_ANON = 'sb_publishable_-_GTb-cNnVnC1gcVHoKlWw_5FztAXMy';

const REPO_ROOT = path.resolve(__dirname, '..');
const TEMPLATE_PATH = path.join(REPO_ROOT, 'profile', 'index.html');
const PROFILE_DIR = path.join(REPO_ROOT, 'profile');

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'apikey': SB_ANON,
        'Authorization': 'Bearer ' + SB_ANON,
        'Accept': 'application/json',
      },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchActiveCompanies() {
  const qs = new URLSearchParams({
    is_published: 'eq.true',
    select: 'slug,hero_sub,owner_intro_photo_url,company:companies(id,name,is_paid,logo_url)',
  }).toString();
  const rows = await fetchJson(`${SB_URL}/rest/v1/company_homepages?${qs}`);
  return rows.filter(r => {
    if (!r.slug) return false;
    if (!r.company) return false;
    // 체험 만료 같은 검증은 런타임에 하고, 빌드는 발행된 것만
    return true;
  });
}

function buildPageForCompany(template, row) {
  const company = row.company || {};
  const companyName = company.name || '';
  const slug = row.slug;
  const heroSub = (row.hero_sub || '').trim();
  // 우선순위: 회사 로고 > 대표 사진 > 클매 로고
  const imageUrl = (company.logo_url || row.owner_intro_photo_url || '').trim()
    || 'https://cleaningmanager.kr/assets/cm_logo.png';

  const ogTitle = companyName
    ? `${companyName} — 클리닝매니저 신뢰 프로필`
    : '클리닝매니저 신뢰 프로필';
  const ogDescription = heroSub
    ? heroSub.replace(/\n/g, ' ')
    : '실제 작업 기록과 후기를 기반으로 고객이 직접 확인할 수 있습니다.';
  const ogUrl = `https://cleaningmanager.kr/profile/${slug}/`;
  const pageTitle = companyName
    ? `${companyName} — 신뢰 프로필`
    : '신뢰 프로필';

  let html = template;

  // <title>
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escHtml(pageTitle)}</title>`
  );

  // og:title
  html = html.replace(
    /<meta property="og:title"[^>]*>/,
    `<meta property="og:title" content="${escHtml(ogTitle)}">`
  );

  // og:description
  html = html.replace(
    /<meta property="og:description"[^>]*>/,
    `<meta property="og:description" content="${escHtml(ogDescription)}">`
  );

  // og:image
  html = html.replace(
    /<meta property="og:image"[^>]*>/,
    `<meta property="og:image" content="${escHtml(imageUrl)}">`
  );

  // og:url 추가 (템플릿에 없으면 og:image 다음에 삽입)
  if (!/<meta property="og:url"/.test(html)) {
    html = html.replace(
      /<meta property="og:image"[^>]*>/,
      (m) => `${m}\n<meta property="og:url" content="${escHtml(ogUrl)}">`
    );
  } else {
    html = html.replace(
      /<meta property="og:url"[^>]*>/,
      `<meta property="og:url" content="${escHtml(ogUrl)}">`
    );
  }

  return html;
}

async function main() {
  console.log('📦 OG 페이지 빌드 시작');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  console.log(`✓ 템플릿 로드: ${TEMPLATE_PATH}`);

  const companies = await fetchActiveCompanies();
  console.log(`✓ 활성 회사 ${companies.length}개`);

  let built = 0;
  for (const row of companies) {
    const slug = row.slug;
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      console.warn(`⚠️  잘못된 slug 패턴 건너뜀: ${slug}`);
      continue;
    }
    const dir = path.join(PROFILE_DIR, slug);
    fs.mkdirSync(dir, { recursive: true });
    const html = buildPageForCompany(template, row);
    fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
    built++;
    console.log(`  + /profile/${slug}/`);
  }
  console.log(`✅ 완료: ${built}개 생성`);
}

main().catch((e) => {
  console.error('❌ 빌드 실패:', e.message);
  process.exit(1);
});
