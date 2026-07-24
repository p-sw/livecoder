// ponytail: one process — nest serves both the api and the built web/dist
// on the same port (10006). Saves an nginx hop and matches the dev setup.
//
// The api cwd is apps/api so bun reads the workspace's tsconfig.json
// (with experimentalDecorators + emitDecoratorMetadata). Running from
// the repo root under bun 1.3.14 breaks NestJS's legacy decorator
// metadata handling.

module.exports = {
  apps: [
    {
      name: 'livecoder',
      script: '/home/programmer/.bun/bin/bun',
      args: 'src/main.ts',
      cwd: '/home/programmer/livecoder/apps/api',
      env: {
        NODE_ENV: 'production',
        PORT: 10006,
        HOST: '0.0.0.0',
      },
      watch: false,
      max_memory_restart: '500M',
      autorestart: true,
      max_restarts: 10,
      out_file: '/home/programmer/livecoder/.runtime/pm2-out.log',
      error_file: '/home/programmer/livecoder/.runtime/pm2-error.log',
    },
  ],
};
