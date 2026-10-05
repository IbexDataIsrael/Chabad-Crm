/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return {
      beforeFiles: [
        // MAINTENANCE MODE: every route serves the renovation page.
        // To reopen: restore this file from main.
        {
          source: "/:path*",
          destination: "/maintenance.html",
        },
      ],
    };
  },
  async redirects() {
    return [
      {
        source: "/dashboard/tasks/:id/paper-entry",
        destination: "/dashboard/apartments?task_id=:id",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
