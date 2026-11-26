import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_TEST_DIST || ".next",
  // The floating development badge overlaps the dungeon movement controls.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
