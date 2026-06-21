import type { MetadataRoute } from "next";

// Block all crawlers from the entire admin surface.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
