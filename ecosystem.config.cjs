// PM2 config for local sandbox testing of the Vaidyam Next.js app.
module.exports = {
  apps: [
    {
      name: "webapp",
      script: "node_modules/next/dist/bin/next",
      args: "start -H 0.0.0.0 -p 3000",
      cwd: "/home/user/webapp",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      watch: false,
      instances: 1,
      exec_mode: "fork",
    },
  ],
};
