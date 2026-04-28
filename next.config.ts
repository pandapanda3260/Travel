const projectRoot = import.meta.dirname;

const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingExcludes: {
    "/*": ["./next.config.ts"],
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
