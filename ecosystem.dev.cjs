module.exports = {
  apps: [{
    name: "webapp-dev",
    script: "node_modules/next/dist/bin/next",
    args: "dev -H 0.0.0.0 -p 3000",
    cwd: "/home/user/webapp",
    env: { NODE_ENV: "development", PORT: 3000, NODE_OPTIONS: "--max-old-space-size=640" },
    watch: false, instances: 1, exec_mode: "fork"
  }]
};
