const path = require('path');

module.exports = {
  apps: [
    {
      name: 'kovo',
      cwd: path.join(__dirname, '..', 'backend'),
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
