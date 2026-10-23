import { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { buildProjects } from "./scripts/buildProjects.mjs";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  // Separate output dir so the mocap lab and the editor dev servers can run at
  // the same time.
  distDir: process.env.NODE_ENV === "production" ? "docs"
    : process.env.MOCAP_LAB === "1" ? ".next-mocap-lab" : undefined,
  basePath: basePath || undefined,
  assetPrefix: basePath ? `${basePath}/` : undefined,
  trailingSlash: true,
};

export default async function configureNext(phase: string): Promise<NextConfig> {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  return {
    ...nextConfig,
    // Local projects are private: the catalog and the files are only exposed
    // by the dev server.
    env: { LOCAL_PROJECTS: JSON.stringify(await buildProjects()) },
    // `*.dev.tsx` and `*.dev.ts` files are only routed by `next dev`.
    pageExtensions: ["dev.tsx", "dev.ts", "tsx", "ts", "jsx", "js"],
  };
}
