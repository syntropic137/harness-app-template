import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'harness-app-template';
const basePath = process.env.GITHUB_PAGES === 'true' ? `/${repoName}` : '';

/** @type {import('next').NextConfig} */
const config = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
  output: 'export',
  reactStrictMode: true,
  trailingSlash: true,
};

export default withMDX(config);
