import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";
import { withSentry } from "@/lib/sentry/init";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
      {
        protocol: "https",
        hostname: "startup-template-sage.vercel.app",
      },
      // Allow S3 bucket images
      {
        protocol: "https",
        hostname: `${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`,
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/docs/:path*.mdx",
        destination: "/llms.mdx/:path*",
      },
    ];
  },
  experimental: {
    authInterrupts: true,
  },
};

const withMDX = createMDX();

export default withSentry(withMDX(nextConfig));
