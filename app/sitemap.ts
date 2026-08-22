import type { MetadataRoute } from "next";
const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://www.sirensforge.vip";
const routes = ["", "/pricing", "/faq", "/contact", "/terms", "/privacy", "/acceptable-use", "/community-guidelines", "/underage-policy", "/blocked-content", "/content-removal", "/report-intimate-content", "/complaints", "/dmca", "/2257-exemption", "/affiliate-terms", "/age"];
export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({ url: `${origin}${route}`, changeFrequency: route === "" ? "weekly" : "monthly" }));
}
