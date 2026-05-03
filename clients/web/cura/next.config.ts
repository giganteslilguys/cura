import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow the dev server to accept Server Actions and HMR requests coming
  // from ngrok tunnels (used by scripts/dev-with-ngrok.sh). Dev-only.
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.app", "*.ngrok.io"],
  devIndicators: false
};

export default nextConfig;
