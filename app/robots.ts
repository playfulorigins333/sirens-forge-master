import type { MetadataRoute } from "next";
const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://www.sirensforge.vip";
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/admin/", "/dashboard", "/account", "/billing", "/creator/", "/generate", "/identities", "/library", "/lora/", "/sirens-mind", "/autopost"] }, sitemap: `${origin}/sitemap.xml` };
}
