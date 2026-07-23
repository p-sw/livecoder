import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { dirname } from 'node:path';
import { WorkspaceService } from './workspace.service.js';

@Controller('api')
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @Get('fs/browse')
  browse(@Query('path') path?: string) {
    return this.workspaces.browse(path);
  }

  @Post('workspace')
  open(@Body() body: { path?: string }) {
    if (!body?.path?.trim()) throw new BadRequestException('A folder path is required');
    return this.workspaces.open(body.path);
  }

  @Get('workspace/entries')
  entries(@Query('path') path?: string) {
    if (!path) throw new BadRequestException('A directory path is required');
    return this.workspaces.entries(path);
  }

  @Get('file')
  file(@Query('path') path?: string, @Query('workspace') workspace?: string) {
    if (!path) throw new BadRequestException('A file path is required');
    return this.workspaces.readFile(path, workspace);
  }

  @Put('file')
  save(
    @Body() body: { path?: string; content?: unknown; workspace?: string },
  ) {
    if (!body?.path) throw new BadRequestException('A file path is required');
    return this.workspaces.writeFile(body.path, body.content, body.workspace);
  }

  @Get('watch')
  async watch(
    @Query('workspace') workspace: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (!workspace) throw new BadRequestException('A workspace path is required');
    const root = this.workspaces.resolvePath(workspace);
    await this.workspaces.assertDirectory(root);

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders?.();
    response.write(`data: ${JSON.stringify({ type: 'ready', path: root })}\n\n`);

    let closed = false;
    const close = this.workspaces.watch(root, (path) => {
      if (closed || response.writableEnded) return;
      response.write(`data: ${JSON.stringify({ type: 'change', path, directory: dirname(path) })}\n\n`);
    });
    const heartbeat = setInterval(() => {
      if (!closed && !response.writableEnded) response.write(': ping\n\n');
    }, 20_000);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      close();
      if (!response.writableEnded) response.end();
    };
    request.on('close', cleanup);
  }
}
