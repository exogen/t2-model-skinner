import { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: process.env.NODE_ENV === "production" ? "docs" : undefined,
  basePath: "/t2-model-skinner",
  assetPrefix: "/t2-model-skinner/",
  trailingSlash: true,
};

export default nextConfig;
