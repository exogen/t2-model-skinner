module.exports = async () => {
  const { getSkinConfig } = await import("./config/models.mjs");
  const publicRuntimeConfig = await getSkinConfig();

  const nextConfig = {
    reactStrictMode: true,
    productionBrowserSourceMaps: true,
    publicRuntimeConfig,
    output: "export",
    distDir: "docs",
  };

  if (process.env.NODE_ENV === "production") {
    nextConfig.basePath = "/t2-model-skinner";
  }

  return nextConfig;
};
