// Official DepEd letterhead (header + footer) used on every report.
// Drawn once on a canvas at high resolution so PDF and Excel exports look
// the same on any computer, with or without the Old English font installed.
import type { SchoolSettings } from '../types';

// a restrained blackletter — formal, but less ornate than Old English Text
export const LETTERHEAD_FONT = 'Grenze Gotisch';
const TEXT = '#595959';
const RULE = '#808080';

export interface LetterheadContent {
  republic: string;
  department: string;
  region: string;
  division: string;
  schoolLine: string;
  address: string;
  phone: string;
  email: string;
  facebook: string;
  qnhsLogo: string;
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Letterhead text, from School settings. */
export function letterheadContent(s: SchoolSettings | undefined): LetterheadContent {
  const school = s?.school_name ?? 'QUIOT NATIONAL HIGH SCHOOL';
  return {
    republic: s?.header_line1 ?? 'Republic of the Philippines',
    department: s?.header_line2 ?? 'Department of Education',
    // "Region VII, Central Visayas" → "REGION VII - CENTRAL VISAYAS"
    region: (s?.region ?? 'Region VII, Central Visayas').toUpperCase().replace(/\s*,\s*/, ' - '),
    division: s?.division ?? 'Schools Division of Cebu City, South District 2',
    schoolLine: `${school.toUpperCase()} @ SCHOOL ID: ${s?.school_id_no ?? '312515'}`,
    address: s?.address ?? 'Sitio Bogo, Quiot, Cebu City',
    phone: s?.phone ?? '(032) 326-2623',
    email: s?.email ?? 'quioths.cebucity@deped.gov.ph',
    facebook: titleCase(school),
    qnhsLogo: s?.logo_url || '/logos/qnhs.png',
  };
}

// Small contact icons (as in the school's letterhead)
export const CONTACT_ICONS = {
  location:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#6E86A6"/><path d="M12 5.5a4.3 4.3 0 0 0-4.3 4.3c0 3.2 4.3 8.2 4.3 8.2s4.3-5 4.3-8.2A4.3 4.3 0 0 0 12 5.5zm0 6a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" fill="#fff"/></svg>',
  phone:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#3FA9E0"/><path d="M15.6 13.8l-1.5-.7a.9.9 0 0 0-1 .2l-.6.7a6.7 6.7 0 0 1-2.9-2.9l.7-.6a.9.9 0 0 0 .2-1l-.7-1.5a.9.9 0 0 0-1-.5l-1.3.3a.9.9 0 0 0-.7.9 9.4 9.4 0 0 0 9.4 9.4.9.9 0 0 0 .9-.7l.3-1.3a.9.9 0 0 0-.5-1z" fill="#fff"/></svg>',
  email:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 6.5v11A1.5 1.5 0 0 0 3.5 19H6V10.2l6 4.3 6-4.3V19h2.5a1.5 1.5 0 0 0 1.5-1.5v-11L12 13z" fill="#EA4335"/><path d="M2 6.5 12 13l10-6.5A1.5 1.5 0 0 0 20.5 5h-17A1.5 1.5 0 0 0 2 6.5z" fill="#C5221F" opacity=".25"/><path d="M2 6.5V9l4 2.9V19H3.5A1.5 1.5 0 0 1 2 17.5z" fill="#4285F4"/><path d="M22 6.5V9l-4 2.9V19h2.5a1.5 1.5 0 0 0 1.5-1.5z" fill="#34A853"/><path d="M2 6.5 6 9.4V6.3L3.8 5A1.5 1.5 0 0 0 2 6.5z" fill="#C5221F"/><path d="M22 6.5 18 9.4V6.3L20.2 5A1.5 1.5 0 0 1 22 6.5z" fill="#FBBC04"/></svg>',
  facebook:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#1877F2"/><path d="M13.3 19.5v-6.2h2.1l.3-2.5h-2.4V9.3c0-.7.2-1.2 1.2-1.2h1.3V5.9a17 17 0 0 0-1.9-.1c-1.9 0-3.2 1.2-3.2 3.3v1.8H8.6v2.5h2.1v6.2z" fill="#fff"/></svg>',
};
export const svgDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function ensureFonts() {
  try {
    await Promise.all([
      document.fonts.load(`500 22px "${LETTERHEAD_FONT}"`),
      document.fonts.load('bold 15px Arial'),
    ]);
  } catch {
    /* fall back to the default serif */
  }
}

/** Draw an image inside a box, keeping its aspect ratio, centred in the box. */
function drawContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, w: number, h: number) {
  if (!img) return;
  const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * r;
  const dh = img.naturalHeight * r;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

export interface LetterheadImages {
  header: { dataUrl: string; width: number; height: number };
  footer: { dataUrl: string; width: number; height: number };
}

const W = 760; // logical width in px (rendered at 3×)
const SCALE = 3;

function canvas(h: number) {
  const c = document.createElement('canvas');
  c.width = W * SCALE;
  c.height = h * SCALE;
  const ctx = c.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  return { c, ctx };
}

let cache: { key: string; images: LetterheadImages } | null = null;

/** Header and footer as PNG data URLs (cached per settings). */
export async function renderLetterhead(settings: SchoolSettings | undefined): Promise<LetterheadImages> {
  const t = letterheadContent(settings);
  const key = JSON.stringify(t);
  if (cache?.key === key) return cache.images;
  await ensureFonts();
  const [seal, bagong, deped, matatag, qnhs, iLoc, iPhone, iMail, iFb] = await Promise.all([
    loadImage('/logos/deped.png'),
    loadImage('/logos/bagong-pilipinas.jpg'),
    loadImage('/logos/deped-wordmark.webp'),
    loadImage('/logos/matatag.png'),
    loadImage(t.qnhsLogo),
    loadImage(svgDataUrl(CONTACT_ICONS.location)),
    loadImage(svgDataUrl(CONTACT_ICONS.phone)),
    loadImage(svgDataUrl(CONTACT_ICONS.email)),
    loadImage(svgDataUrl(CONTACT_ICONS.facebook)),
  ]);

  // ---------------------------------------------------------------- header
  const HH = 152;
  const h = canvas(HH);
  drawContain(h.ctx, seal, W / 2 - 25, 1, 50, 50);
  h.ctx.fillStyle = TEXT;
  h.ctx.font = `500 17px "${LETTERHEAD_FONT}", "Old English Text MT", serif`;
  h.ctx.fillText(t.republic, W / 2, 70);
  h.ctx.font = `500 22px "${LETTERHEAD_FONT}", "Old English Text MT", serif`;
  h.ctx.fillText(t.department, W / 2, 93);
  h.ctx.font = '12px Arial, Helvetica, sans-serif';
  h.ctx.fillText(t.region, W / 2, 109);
  h.ctx.font = 'bold 12.5px Arial, Helvetica, sans-serif';
  h.ctx.fillText(t.division, W / 2, 125);
  h.ctx.fillText(t.schoolLine, W / 2, 140);
  h.ctx.fillStyle = RULE;
  h.ctx.fillRect(0, 146, W, 2.5);

  // ---------------------------------------------------------------- footer
  const FH = 104;
  const f = canvas(FH);
  f.ctx.fillStyle = RULE;
  f.ctx.fillRect(0, 2, W, 1.5);
  // Bagong Pilipinas
  drawContain(f.ctx, bagong, 14, 10, 72, 64);
  f.ctx.fillStyle = '#5B6E8F';
  f.ctx.font = 'bold 9.5px Arial, Helvetica, sans-serif';
  f.ctx.fillText('BAGONG PILIPINAS', 50, 76); // the emblem image has blank space at its bottom
  // DepEd + MATATAG
  drawContain(f.ctx, deped, 108, 12, 112, 46);
  drawContain(f.ctx, matatag, 108, 60, 112, 36);
  // QNHS
  drawContain(f.ctx, qnhs, 232, 10, 84, 84);
  // contact lines
  const rows: [HTMLImageElement | null, string, boolean][] = [
    [iLoc, t.address, false],
    [iPhone, t.phone, false],
    [iMail, t.email, true],
    [iFb, t.facebook, false],
  ];
  f.ctx.textAlign = 'left';
  f.ctx.font = '15px Arial, Helvetica, sans-serif';
  rows.forEach(([icon, text, link], i) => {
    const y = 14 + i * 22;
    drawContain(f.ctx, icon, 372, y, 18, 18);
    f.ctx.fillStyle = link ? '#2F6FB6' : '#555555';
    f.ctx.fillText(text, 398, y + 14);
    if (link) {
      const w = f.ctx.measureText(text).width;
      f.ctx.fillRect(398, y + 16, w, 1);
    }
  });

  const images: LetterheadImages = {
    header: { dataUrl: h.c.toDataURL('image/png'), width: W, height: HH },
    footer: { dataUrl: f.c.toDataURL('image/png'), width: W, height: FH },
  };
  cache = { key, images };
  return images;
}
