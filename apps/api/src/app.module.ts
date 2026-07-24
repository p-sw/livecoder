import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppController } from './app.controller.js';
import { AgentController } from './agent/agent.controller.js';
import { AgentService } from './agent/agent.service.js';
import { GitController } from './git/git.controller.js';
import { GitService } from './git/git.service.js';
import { WorkspaceController } from './workspace/workspace.controller.js';
import { WorkspaceService } from './workspace/workspace.service.js';

const apiDirectory = dirname(fileURLToPath(import.meta.url));

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(apiDirectory, '../../web/dist'),
      exclude: ['/api/{*splat}'],
    }),
  ],
  controllers: [AppController, WorkspaceController, AgentController, GitController],
  providers: [WorkspaceService, AgentService, GitService],
})
export class AppModule {}
