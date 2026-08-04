import type { NextConfig } from 'next'

const backendInternal =
  (process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

const nextConfig: NextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  // Activa el MCP server en /_next/mcp (Next.js 16+)
  experimental: {
    mcpServer: true,
    // Ayuda a que Next transforme imports de paquetes grandes en imports por módulo.
    optimizePackageImports: ['recharts', 'react-chartjs-2', 'chart.js'],
  },
  async rewrites() {
    return [
      {
        source: '/api-backend/:path*',
        destination: `${backendInternal}/:path*`,
      },
      {
        source: '/media/:path*',
        destination: `${backendInternal}/media/:path*`,
      },
    ]
  },
}

export default nextConfig
