// PM2 process manager configuration
// Usage: pm2 start ecosystem.config.js --env production
module.exports = {
  apps: [{
    name: 'flow',
    script: './backend/server.js',
    cwd: __dirname,
    instances: 1,          // single writer; keep at 1
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'development',
      PORT: 3001,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
