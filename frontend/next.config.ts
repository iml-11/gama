import type { NextConfig } from "next";

// The scientific engine (FastAPI) runs separately; /api/* is proxied to it so
// the browser talks to a single origin.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
