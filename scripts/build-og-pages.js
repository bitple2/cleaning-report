#!/usr/bin/env node
/**
 * 회사별 신뢰 프로필 SSG (정적 사이트 생성).
 *
 * Supabase에서 발행 회사 + 모든 데이터(통계·작업·후기·외부후기·대표인사·정보카드)
 * fetch → profile/index.html 템플릿에 인라인으로 박음 → /profile/{slug}/index.html 생성.
 *
 * 결과: 첫 로드 시 모든 콘텐츠 즉시 표시 (JS fetch 필요 없음).
 * inline script도 그대로 두면 클라이언트에서 최신 데이터로 덮어쓰기 →
 * 사장님 변경이 빌드 전이라도 페이지 접속 시 즉시 반영됨.
 *
 * 기존 404.html 동적 라우팅과 공존: 빌드 안 된 신규 회사도 fallback 작동.
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

// ─── HTTP helpers ───
function httpRequest(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => buf += chunk);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf}`));
        }
        try { resolve(buf ? JSON.parse(buf) : null); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function fetchGet(urlPath) {
  const u = new URL(SB_URL + urlPath);
  return httpRequest({
    hostname: u.hostname,
    path: u.pathname + u.search,
    method: 'GET',
    headers: {
      'apikey': SB_ANON,
      'Authorization': 'Bearer ' + SB_ANON,
      'Accept': 'application/json',
    },
  });
}

function fetchRpc(fnName, payload) {
  const u = new URL(SB_URL + `/rest/v1/rpc/${fnName}`);
  const body = JSON.stringify(payload || {});
  return httpRequest({
    hostname: u.hostname,
    path: u.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'apikey': SB_ANON,
      'Authorization': 'Bearer ' + SB_ANON,
      'Accept': 'application/json',
    },
  }, body);
}

// ─── Format helpers ───
function formatRelativeDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (diff < 1) return '오늘';
  if (diff === 1) return '1일 전';
  if (diff < 7) return diff + '일 전';
  if (diff < 30) return Math.floor(diff / 7) + '주 전';
  if (diff < 365) return Math.floor(diff / 30) + '개월 전';
  return Math.floor(diff / 365) + '년 전';
}

// ─── Section builders ───
function buildBadges(stats) {
  const s = stats || {};
  const reportsN = s.reports_count || 0;
  const reviewsN = s.reviews_count || 0;
  const avgRating = Number(s.avg_rating || 0);
  const certReviewN = s.cert_review_count || 0;
  const consecMonths = s.consecutive_months || 0;
  const recent30dN = s.recent_30d_reports || 0;
  const earned = [];

  if (reportsN >= 1000) earned.push({ emoji: '💎', label: '1000건 달성', sub: '누적 작업 ' + reportsN + '건' });
  else if (reportsN >= 300) earned.push({ emoji: '🥇', label: '300건 달성', sub: '누적 작업 ' + reportsN + '건' });
  else if (reportsN >= 100) earned.push({ emoji: '🥈', label: '100건 달성', sub: '누적 작업 ' + reportsN + '건' });
  else if (reportsN >= 30) earned.push({ emoji: '🥉', label: '30건 달성', sub: '누적 작업 ' + reportsN + '건' });
  else earned.push({ emoji: '🥉', label: '30건 달성', sub: '누적 ' + reportsN + '건', locked: true });

  if (reviewsN >= 1) {
    const rStr = avgRating.toFixed(1);
    const rFloat = parseFloat(rStr);
    if (avgRating >= 5.0) earned.push({ emoji: '⭐', label: '평점 5.0 만점', sub: '고객 만족 우수 업체' });
    else if (rFloat >= 4.9) earned.push({ emoji: '⭐', label: '평점 ' + rStr, sub: '고객 만족 우수 업체' });
    else if (rFloat >= 4.5) earned.push({ emoji: '⭐', label: '평점 ' + rStr, sub: '고객 만족도' });
    else earned.push({ emoji: '⭐', label: '평점 4.5', sub: '현재 ' + rStr, locked: true });
  } else {
    earned.push({ emoji: '⭐', label: '평점 4.5', sub: '후기 0건', locked: true });
  }

  if (certReviewN >= 1) earned.push({ emoji: '🔐', label: '인증 후기 ' + certReviewN + '건', sub: '실제 고객 검증' });
  else earned.push({ emoji: '🔐', label: '인증 후기', sub: '0건', locked: true });

  if (consecMonths >= 12) earned.push({ emoji: '🔁', label: '1년 연속 활동', sub: '꾸준한 운영' });
  else if (consecMonths >= 6) earned.push({ emoji: '🔁', label: '6개월 연속 활동', sub: '꾸준한 운영' });
  else if (consecMonths >= 3) earned.push({ emoji: '🔁', label: '3개월 연속 활동', sub: '꾸준한 운영' });
  else earned.push({ emoji: '🔁', label: '3개월 연속', sub: consecMonths > 0 ? '현재 ' + consecMonths + '개월' : '이번 달 활동 없음', locked: true });

  if (recent30dN >= 3) earned.push({ emoji: '📸', label: '작업 과정 공개', sub: '실시간 리포트 제공 중' });
  else earned.push({ emoji: '📸', label: '작업 과정 공개', sub: '최근 30일 ' + recent30dN + '건', locked: true });

  return earned.map(b => {
    const cls = b.locked ? 'badge-card locked' : 'badge-card';
    return `<div class="${cls}"><div class="badge-emoji">${b.emoji}</div>` +
      `<div class="badge-label">${escHtml(b.label)}</div>` +
      (b.sub ? `<div class="badge-sub">${escHtml(b.sub)}</div>` : '') +
      `</div>`;
  }).join('');
}

function buildRecentWorks(works) {
  if (!Array.isArray(works) || works.length === 0) return null;
  return '<div class="work-list">' + works.map(w => {
    const dt = new Date(w.date);
    const dateStr = (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일';
    const region = escHtml(w.address_region || '—');
    const pyeong = w.size_pyeong != null ? w.size_pyeong : '—';
    const service = escHtml(w.service_type || '');
    const photoCount = w.photo_count || 0;
    const photoHtml = w.photo_url
      ? `<img src="${escHtml(w.photo_url)}" alt="">`
      : `<div class="work-photo-empty">📷</div>`;
    return `<a class="work-card" href="/?id=${encodeURIComponent(w.report_id)}&public=1">` +
      `<div class="work-photo">${photoHtml}<span class="work-date-badge">${dateStr}</span></div>` +
      `<div class="work-meta">` +
        `<div class="work-region">${region}</div>` +
        `<div class="work-spec">${pyeong}평 · ${service}</div>` +
        `<div class="work-photo-count">사진 ${photoCount}장</div>` +
        `<div class="work-report-btn">리포트 보기 ›</div>` +
      `</div></a>`;
  }).join('') + '</div>';
}

function buildReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length === 0) return null;
  return '<div class="rev-list">' + reviews.map(r => {
    const rating = Number(r.rating || 0).toFixed(1);
    const ratingStars = '★'.repeat(Math.round(r.rating || 0)) + '☆'.repeat(5 - Math.round(r.rating || 0));
    const content = escHtml(r.content || '').replace(/\n/g, '<br>');
    const dt = new Date(r.created_at);
    const dateStr = (dt.getMonth() + 1) + '월 ' + dt.getDate() + '일';
    const service = r.service_type_snapshot ? ' · ' + escHtml(r.service_type_snapshot) : '';
    const name = r.name_display === 'anonymous' ? '익명'
      : (r.customer_name_snapshot ? escHtml(r.customer_name_snapshot.charAt(0)) + '*' : '익명');
    const phoneDigits = (r.customer_phone_snapshot || '').replace(/\D/g, '');
    const phoneMasked = phoneDigits.length >= 4 ? ' · 010-****-**' + phoneDigits.slice(-2) : '';
    const certCode = (r.cert_code || '').replace(/^#/, '');
    const verifyUrl = certCode ? '/verify/' + encodeURIComponent(certCode) : '';
    const qrTarget = certCode ? 'https://cleaningmanager.kr/verify/' + certCode : '';
    const qrImg = qrTarget
      ? `<img class="rev-qr" alt="" src="https://api.qrserver.com/v1/create-qr-code/?size=80x80&margin=0&data=${encodeURIComponent(qrTarget)}">`
      : '';
    const verifyBlock = certCode
      ? `<div class="rev-verify">${qrImg}<span class="rev-verify-text"><span class="rev-verify-label">✓ 검증</span><span class="rev-cert-code">#${escHtml(certCode)}</span></span></div>`
      : '';
    const cardOpen = certCode
      ? `<a class="rev-card" href="${verifyUrl}" target="_blank" rel="noopener">`
      : `<div class="rev-card">`;
    const cardClose = certCode ? '</a>' : '</div>';
    return cardOpen +
      `<div class="rev-header"><div class="rev-rating-row"><div class="rev-rating"><span class="rev-rating-stars">${ratingStars}</span> ${rating}</div><div class="rev-date">${dateStr}</div></div>${verifyBlock}</div>` +
      `<p class="rev-content">${content}</p>` +
      `<div class="rev-meta">${name}${phoneMasked}${service}</div>` +
      cardClose;
  }).join('') + '</div>';
}

function buildGallery(gal) {
  if (!Array.isArray(gal) || gal.length === 0) return { html: null, groupCount: 0 };
  const groups = {};
  const groupOrder = [];
  gal.forEach(g => {
    const cat = (g.category || '').trim() || '기타';
    if (!groups[cat]) { groups[cat] = []; groupOrder.push(cat); }
    groups[cat].push(g);
  });
  const html = '<div class="ext-list">' + groupOrder.map(cat => {
    const items = groups[cat];
    const first = items[0];
    const cap = (first.caption || '').trim();
    const images = items.map(it => it.image_url);
    const imagesJson = escHtml(JSON.stringify(images));
    const countBadge = items.length > 1 ? `<div class="ext-card-count">${items.length}장</div>` : '';
    return `<div class="ext-card" onclick="openExtModalFromEl(this)" data-img-url="${escHtml(first.image_url)}" data-images="${imagesJson}" data-source="${escHtml(cat)}" data-caption="${escHtml(cap)}">` +
      `<div class="ext-card-img">${countBadge}` +
        `<img src="${escHtml(first.image_url)}" alt="" loading="lazy">` +
      `</div>` +
      `<div class="ext-card-body">` +
        `<div class="ext-card-source">${escHtml(cat)}</div>` +
        (cap ? `<div class="ext-card-caption">${escHtml(cap)}</div>` : '') +
      `</div></div>`;
  }).join('') + '</div>';
  return { html, groupCount: groupOrder.length };
}

function buildExternalReviews(ext) {
  if (!Array.isArray(ext) || ext.length === 0) return null;
  return '<div class="ext-list">' + ext.map(e => {
    const src = (e.source_label || '').trim();
    const cap = (e.caption || '').trim();
    return `<div class="ext-card" onclick="openExtModalFromEl(this)" data-img-url="${escHtml(e.image_url)}" data-source="${escHtml(src)}" data-caption="${escHtml(cap)}">` +
      `<div class="ext-card-img"><img src="${escHtml(e.image_url)}" alt="" loading="lazy"></div>` +
      `<div class="ext-card-body">` +
        (src ? `<div class="ext-card-source">${escHtml(src)}</div>` : '') +
        (cap ? `<div class="ext-card-caption">${escHtml(cap)}</div>` : '') +
      `</div></div>`;
  }).join('') + '</div>';
}

function buildInfoCard(row, company) {
  const businessHours = (row.business_hours || '').trim();
  const serviceAreas = (row.service_areas || '').trim();
  const businessNumber = (company.business_number || '').trim();
  const ownerName = (company.owner_name || '').trim();
  if (!businessHours && !serviceAreas && !businessNumber) return null;
  const rows = [];
  if (businessHours) rows.push(`<div class="info-row"><div class="info-icon">🕐</div><div class="info-value">${escHtml(businessHours)}</div></div>`);
  if (serviceAreas) rows.push(`<div class="info-row"><div class="info-icon">📍</div><div class="info-value">${escHtml(serviceAreas)}</div></div>`);
  if (businessNumber) {
    const ownerLine = ownerName ? ' · 대표 ' + escHtml(ownerName) : '';
    rows.push(`<div class="info-row"><div class="info-icon">🏢</div><div class="info-value">${escHtml(businessNumber)}${ownerLine}</div></div>`);
  }
  return `<div class="info-card">${rows.join('')}</div>`;
}

// ─── 메인 빌드 ───
async function fetchActiveCompanies() {
  const qs = new URLSearchParams({
    is_published: 'eq.true',
    select: '*,company:companies(id,name,owner_name,business_number,is_paid,logo_url)',
  }).toString();
  const rows = await fetchGet(`/rest/v1/company_homepages?${qs}`);
  return rows.filter(r => r.slug && r.company);
}

async function fetchAllData(slug, companyId) {
  const tasks = [
    fetchRpc('public_profile_stats', { profile_slug: slug }).catch(() => null),
    fetchRpc('public_profile_recent_work', { profile_slug: slug, work_limit: 6 }).catch(() => []),
    fetchGet(`/rest/v1/reviews?` + new URLSearchParams({
      company_id: 'eq.' + companyId,
      is_hidden: 'eq.false',
      'cert_code': 'not.is.null',
      select: 'rating,content,name_display,customer_name_snapshot,customer_phone_snapshot,service_type_snapshot,created_at,cert_code',
      order: 'created_at.desc',
      limit: '3',
    }).toString()).catch(() => []),
    fetchGet(`/rest/v1/external_review_screenshots?` + new URLSearchParams({
      company_id: 'eq.' + companyId,
      select: 'image_url,source_label,caption,sort_order',
      order: 'sort_order.asc,created_at.desc',
    }).toString()).catch(() => []),
    fetchGet(`/rest/v1/company_gallery?` + new URLSearchParams({
      company_id: 'eq.' + companyId,
      select: 'image_url,category,caption,sort_order',
      order: 'sort_order.asc,created_at.desc',
    }).toString()).catch(() => []),
    fetchGet(`/rest/v1/company_sns_links?` + new URLSearchParams({
      company_id: 'eq.' + companyId,
      select: 'platform,url,label,sort_order',
      order: 'sort_order.asc,created_at.desc',
    }).toString()).catch(() => []),
  ];
  const [stats, works, reviews, ext, gal, sns] = await Promise.all(tasks);
  return {
    stats,
    works: works || [],
    reviews: reviews || [],
    ext: ext || [],
    gal: gal || [],
    sns: sns || [],
  };
}

function buildPageForCompany(template, row, data) {
  const company = row.company || {};
  const companyName = company.name || '';
  const slug = row.slug;
  const heroSub = (row.hero_sub || '').trim();
  const logoUrl = (company.logo_url || row.hero_poster_url || '').trim();
  const isPaid = !!company.is_paid;
  const imageUrl = logoUrl || (row.owner_intro_photo_url || '').trim()
    || 'https://cleaningmanager.kr/assets/cm_logo.png';
  const ogTitle = companyName || '클리닝매니저 신뢰 프로필';
  const ogDescription = heroSub ? heroSub.replace(/\n/g, ' ')
    : '실제 작업 기록과 후기를 기반으로 고객이 직접 확인할 수 있습니다.';
  const ogUrl = `https://cleaningmanager.kr/profile/${slug}/`;
  const pageTitle = companyName || '신뢰 프로필';

  let html = template;

  // <title> + OG
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(pageTitle)}</title>`);
  html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escHtml(ogTitle)}">`);
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escHtml(ogDescription)}">`);
  html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${escHtml(imageUrl)}">`);
  if (!/<meta property="og:url"/.test(html)) {
    html = html.replace(/<meta property="og:image"[^>]*>/, (m) => `${m}\n<meta property="og:url" content="${escHtml(ogUrl)}">`);
  } else {
    html = html.replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${escHtml(ogUrl)}">`);
  }

  // 회사명·카피·아바타·인증 마크
  if (companyName) {
    html = html.replace(/<span data-company-name>[^<]*<\/span>/, `<span data-company-name>${escHtml(companyName)}</span>`);
  }
  if (heroSub) {
    const heroSubHtml = escHtml(heroSub).replace(/\n/g, '<br>');
    html = html.replace(/<p class="hero-sub" data-hero-sub>[\s\S]*?<\/p>/, `<p class="hero-sub" data-hero-sub>${heroSubHtml}</p>`);
  }
  if (logoUrl) {
    html = html.replace(/<div class="avatar-fallback"[^>]*>[\s\S]*?<\/div>/, `<img src="${escHtml(logoUrl)}" alt="${escHtml(companyName)}">`);
  }
  if (isPaid) {
    html = html.replace(/<div class="hero-verified" data-verified-hero style="display:none;">/, `<div class="hero-verified" data-verified-hero>`);
  }

  // 신뢰 배지
  const badgesHtml = buildBadges(data.stats);
  if (badgesHtml) {
    html = html.replace(/<div class="badge-list" data-badges-list><\/div>/, `<div class="badge-list" data-badges-list>${badgesHtml}</div>`);
    html = html.replace(/<div data-badges-wrap class="badges-wrap" style="display:none;">/, `<div data-badges-wrap class="badges-wrap">`);
  }

  // 최근 작업 inline
  if (data.stats && data.stats.last_report_at) {
    const lastWorkText = '· 최근 작업 ' + formatRelativeDate(data.stats.last_report_at);
    html = html.replace(/<span class="section-title-meta" data-last-work-inline><\/span>/, `<span class="section-title-meta" data-last-work-inline>${escHtml(lastWorkText)}</span>`);
  }

  // 최근 작업 카드
  const worksHtml = buildRecentWorks(data.works);
  if (worksHtml) {
    html = html.replace(
      /<div data-recent-work-list>[\s\S]*?<\/div>\s*<\/div>(?=\s*<\/div>\s*<div class="section-card">)/m,
      `<div data-recent-work-list>${worksHtml}</div>`
    );
    // 위 정규식이 안 맞을 경우 fallback
    if (html.indexOf('data-work-empty') !== -1 && html.indexOf(worksHtml) === -1) {
      html = html.replace(
        /<div data-recent-work-list>\s*<div class="coming-soon" data-work-empty>[\s\S]*?<\/div>\s*<\/div>/m,
        `<div data-recent-work-list>${worksHtml}</div>`
      );
    }
  }

  // 인증 후기
  const reviewsHtml = buildReviews(data.reviews);
  if (reviewsHtml) {
    html = html.replace(
      /<div data-reviews-list>\s*<div class="coming-soon" data-reviews-empty>[\s\S]*?<\/div>\s*<\/div>/m,
      `<div data-reviews-list>${reviewsHtml}</div>`
    );
  }

  // 갤러리 (카테고리별 그룹화)
  if (data.gal && data.gal.length > 0) {
    const { html: galHtml, groupCount } = buildGallery(data.gal);
    if (galHtml) {
      html = html.replace(/<div class="section-card" data-gallery-section style="display:none;">/, `<div class="section-card" data-gallery-section>`);
      html = html.replace(/<span class="section-title-meta" data-gallery-count><\/span>/, `<span class="section-title-meta" data-gallery-count>· ${groupCount}개</span>`);
      html = html.replace(/<div data-gallery-list><\/div>/, `<div data-gallery-list>${galHtml}</div>`);
    }
  }

  // 외부 후기
  if (data.ext && data.ext.length > 0) {
    const extHtml = buildExternalReviews(data.ext);
    html = html.replace(/<div class="section-card" data-external-reviews-section style="display:none;">/, `<div class="section-card" data-external-reviews-section>`);
    html = html.replace(/<span class="section-title-meta" data-ext-count><\/span>/, `<span class="section-title-meta" data-ext-count>· ${data.ext.length}개</span>`);
    html = html.replace(/<div data-external-reviews-list><\/div>/, `<div data-external-reviews-list>${extHtml}</div>`);
  }

  // 대표 인사
  const ownerIntroText = (row.owner_intro_text || '').trim();
  const ownerIntroPhoto = (row.owner_intro_photo_url || '').trim();
  const visMap = (row.section_visibility && typeof row.section_visibility === 'object') ? row.section_visibility : {};
  const ownerVisible = visMap.owner !== false;
  if (ownerVisible && (ownerIntroText || ownerIntroPhoto)) {
    html = html.replace(/<div class="section-card" data-owner-intro-section style="display:none;">/, `<div class="section-card" data-owner-intro-section>`);
    if (ownerIntroPhoto) {
      html = html.replace(/<div class="owner-intro-photo" data-owner-intro-photo><\/div>/, `<div class="owner-intro-photo" data-owner-intro-photo><img src="${escHtml(ownerIntroPhoto)}" alt="대표 사진"></div>`);
    }
    if (ownerIntroText) {
      html = html.replace(/<p class="owner-intro-text" data-owner-intro-text><\/p>/, `<p class="owner-intro-text" data-owner-intro-text>${escHtml(ownerIntroText)}</p>`);
    }
  }

  // 카카오톡
  if ((row.kakao_channel_url || '').trim()) {
    html = html.replace(/<div class="cta-kakao-wrap" data-kakao-wrap style="display:none;">/, `<div class="cta-kakao-wrap" data-kakao-wrap>`);
  }

  // 정보 카드
  const infoHtml = buildInfoCard(row, company);
  if (infoHtml) {
    html = html.replace(/<div data-info-card-wrap style="display:none;"><\/div>/, `<div data-info-card-wrap>${infoHtml}</div>`);
  }

  // 하단 CTA 카드의 CONTACT 영역
  const ctaHours = (row.business_hours || '').trim();
  const ctaAreas = (row.service_areas || '').trim();
  html = html.replace(/<div data-cta-hours><\/div>/, `<div data-cta-hours>${escHtml(ctaHours)}</div>`);
  html = html.replace(/<div data-cta-areas><\/div>/, `<div data-cta-areas>${escHtml(ctaAreas)}</div>`);

  // 외부 채널 (SNS)
  if (data.sns && data.sns.length > 0) {
    const PLATFORM_NAMES = {
      instagram: 'Instagram', threads: 'Threads', blog: 'Blog',
      naver_blog: '네이버 블로그', youtube: 'YouTube',
      facebook: 'Facebook', kakao_view: '카카오 채널', etc: '기타',
    };
    const snsHtml = data.sns.map(s => {
      const key = s.platform || 'etc';
      const customLabel = (s.label || '').trim();
      const name = (key === 'etc' && customLabel)
        ? customLabel
        : (PLATFORM_NAMES[key] || '기타');
      return `<a href="${escHtml(s.url)}" target="_blank" rel="noopener">${escHtml(name)}</a>`;
    }).join('');
    html = html.replace(
      /<div class="cta-footer-items" data-sns-list>[\s\S]*?<\/div>/,
      `<div class="cta-footer-items" data-sns-list>${snsHtml}</div>`
    );
  }

  // body 데이터 속성
  html = html.replace(/<body>/, `<body data-company-id="${escHtml(company.id || '')}" data-company-name="${escHtml(companyName)}" data-contact-phone="${escHtml((row.contact_phone || '').trim())}" data-kakao-url="${escHtml((row.kakao_channel_url || '').trim())}">`);

  return html;
}

async function main() {
  console.log('📦 SSG 빌드 시작');
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  console.log(`✓ 템플릿 로드`);
  const companies = await fetchActiveCompanies();
  console.log(`✓ 활성 회사 ${companies.length}개`);

  let built = 0;
  for (const row of companies) {
    const slug = row.slug;
    if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
      console.warn(`⚠️  slug 패턴 위반 건너뜀: ${slug}`);
      continue;
    }
    try {
      const data = await fetchAllData(slug, row.company.id);
      const dir = path.join(PROFILE_DIR, slug);
      fs.mkdirSync(dir, { recursive: true });
      const html = buildPageForCompany(template, row, data);
      fs.writeFileSync(path.join(dir, 'index.html'), html, 'utf8');
      built++;
      console.log(`  + /profile/${slug}/  (작업${data.works.length}·후기${data.reviews.length}·외부${data.ext.length}·갤러리${data.gal.length}·SNS${data.sns.length})`);
    } catch (e) {
      console.error(`  ✗ /profile/${slug}/ 실패: ${e.message}`);
    }
  }
  console.log(`✅ 완료: ${built}개 생성`);
}

main().catch((e) => {
  console.error('❌ 빌드 실패:', e.message);
  process.exit(1);
});
