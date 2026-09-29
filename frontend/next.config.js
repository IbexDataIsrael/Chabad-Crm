/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      // fixes74 §6: the dedicated paper-entry page is gone — old links land
      // on the Apartments view filtered to that task's report numbers.
      {
        source: "/dashboard/tasks/:id/paper-entry",
        destination: "/dashboard/apartments?task_id=:id",
        permanent: true,
      },
    ];
  },
};

module.exports = nextConfig;
