// Search-engine files: structured data must be valid JSON, and every page in the sitemap must exist.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SITE = 'https://abdulaibah479.github.io/kopor/';
const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const ldBlocks = (html: string) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!));

describe('SEO', () => {
  it('index.html has a real title, description, canonical and valid structured data', () => {
    const html = read('index.html');
    expect(html).toMatch(/<title>Kopor: .{20,}<\/title>/);
    expect(html).toContain(`<link rel="canonical" href="${SITE}">`);
    const [ld] = ldBlocks(html);
    const app = ld['@graph'].find((n: { '@type': unknown }) => JSON.stringify(n['@type']).includes('SoftwareApplication'));
    expect(app.offers.map((o: { price: string }) => o.price)).toEqual(['0', '75']);
  });

  it('landing pages have valid structured data and point at each other', () => {
    for (const p of ['public/about/index.html', 'public/krio/index.html']) {
      const html = read(p);
      ldBlocks(html); // throws if any block is not valid JSON
      expect(html).toContain('hreflang="kri"');
      expect(html).toContain('hreflang="en"');
    }
  });

  it('every sitemap address is a real page, and robots.txt names the sitemap', () => {
    const urls = [...read('public/sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    expect(urls.length).toBeGreaterThanOrEqual(3);
    for (const u of urls) {
      expect(u.startsWith(SITE)).toBe(true);
      const path = u.slice(SITE.length);
      expect(existsSync(new URL(`../../${path ? `public/${path}index.html` : 'index.html'}`, import.meta.url))).toBe(true);
    }
    expect(read('public/robots.txt')).toContain(`Sitemap: ${SITE}sitemap.xml`);
  });
});
