// PM2 конфигурация
module.exports = {
  apps: [{
    name: 'dobropost-ai',
    script: 'server/index.js',
    cwd: '/opt/dobropost',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: '/var/log/dobropost-error.log',
    out_file:   '/var/log/dobropost-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
