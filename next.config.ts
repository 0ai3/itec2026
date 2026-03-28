import type { NextConfig } from "next";

const devOriginHost = process.env.NEXT_DEV_ORIGIN_HOST?.trim()

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...(devOriginHost ? [devOriginHost] : [])],
};

export default nextConfig;
