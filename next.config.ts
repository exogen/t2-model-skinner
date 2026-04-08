import { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  distDir: process.env.NODE_ENV === "production" ? "docs" : undefined,
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  trailingSlash: true,
};

export default nextConfig;
