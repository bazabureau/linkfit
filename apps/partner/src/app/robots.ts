import type { MetadataRoute } from "next";

// Private B2B owner panel — disallow all crawling so the login page and
// internal routes never get indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
