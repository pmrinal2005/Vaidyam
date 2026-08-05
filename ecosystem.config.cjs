module.exports = {
  apps: [
    {
      // Serves the exact static bundle that Vercel will host (dist-static/).
      name: 'synapsex',
      script: 'scripts/serve-static.mjs',
      interpreter: 'node',
      cwd: '/home/user/webapp',
      env: {
        NODE_ENV: 'development',
        PORT: 3000,
        HOST: '0.0.0.0'
      },
      watch: false,
      instances: 1,
      exec_mode: 'fork'
    }
  ]
}
