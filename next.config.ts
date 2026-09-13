import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: "/jackson-running",
  assetPrefix: "/jackson-running/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
