// ponytail: the controller exposes thin HTTP shims over the service. Every
// write op takes a `workspace` field so the filesystem path is resolved
// against the user's selection. The clone endpoint is the lone exception —
// it accepts a URL and an optional path.

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GitService } from './git.service.js';

interface WorkspaceBody {
  workspace: string;
  paths?: string[];
  message?: string;
  all?: boolean;
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  prune?: boolean;
  force?: boolean;
  name?: string;
  url?: string;
  create?: boolean;
}

@Controller('api/git')
export class GitController {
  constructor(private readonly git: GitService) {}

  // ponytail: clone lives outside any workspace — it's the entry point.
  // The path is resolved server-side via the configured fallback chain.
  @Post('clone')
  async clone(@Body() body: { url?: string; path?: string }) {
    if (!body?.url) throw new BadRequestException('A repository URL is required');
    return this.git.clone(body.url, body.path);
  }

  @Get('clone-path')
  suggestPath(@Query('name') name?: string) {
    return { ...this.git.clonePathSuggestion(name ?? ''), inferred: name ?? '' };
  }

  @Get('status')
  async status(@Query('workspace') workspace: string) {
    requireWorkspace(workspace);
    return this.git.status(workspace);
  }

  @Get('log')
  async log(@Query('workspace') workspace: string, @Query('limit') limit?: string) {
    requireWorkspace(workspace);
    return this.git.log(workspace, parseLimit(limit));
  }

  @Get('diff')
  async diff(@Query('workspace') workspace: string, @Query('path') path?: string, @Query('staged') staged?: string) {
    requireWorkspace(workspace);
    return this.git.diff(workspace, path, staged === 'true' || staged === '1');
  }

  @Get('show')
  async show(@Query('workspace') workspace: string, @Query('hash') hash: string) {
    requireWorkspace(workspace);
    if (!hash) throw new BadRequestException('A commit hash is required');
    return this.git.show(workspace, hash);
  }

  @Post('stage')
  @HttpCode(204)
  async stage(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    await this.git.stage(body.workspace, body.paths ?? []);
  }

  @Post('unstage')
  @HttpCode(204)
  async unstage(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    await this.git.unstage(body.workspace, body.paths ?? []);
  }

  @Post('commit')
  async commit(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    if (!body.message) throw new BadRequestException('A commit message is required');
    return this.git.commit(body.workspace, body.message, { all: body.all });
  }

  @Post('push')
  async push(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    return this.git.push(body.workspace, { remote: body.remote, branch: body.branch, setUpstream: body.setUpstream });
  }

  @Post('pull')
  async pull(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    return this.git.pull(body.workspace, { remote: body.remote, branch: body.branch });
  }

  @Post('fetch')
  async fetch(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    return this.git.fetch(body.workspace, { remote: body.remote, prune: body.prune });
  }

  @Get('branches')
  async branches(@Query('workspace') workspace: string) {
    requireWorkspace(workspace);
    return this.git.branches(workspace);
  }

  @Post('checkout')
  async checkout(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    if (!body.branch) throw new BadRequestException('A branch name is required');
    return this.git.checkout(body.workspace, body.branch, { create: body.create });
  }

  @Delete('branches/:name')
  async deleteBranch(@Param('name') name: string, @Query('workspace') workspace: string, @Query('force') force?: string) {
    requireWorkspace(workspace);
    return this.git.deleteBranch(workspace, name, force === 'true' || force === '1');
  }

  @Get('tags')
  async tags(@Query('workspace') workspace: string) {
    requireWorkspace(workspace);
    return this.git.tags(workspace);
  }

  @Put('tags')
  async createTag(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    if (!body.name) throw new BadRequestException('A tag name is required');
    return this.git.createTag(body.workspace, body.name, body.message);
  }

  @Delete('tags/:name')
  async deleteTag(
    @Param('name') name: string,
    @Query('workspace') workspace: string,
    @Query('remote') remote?: string,
    @Query('remoteOnly') remoteOnly?: string,
  ) {
    requireWorkspace(workspace);
    if (remoteOnly === 'true' || remoteOnly === '1') {
      return this.git.deleteRemoteTag(workspace, name, remote || 'origin');
    }
    const local = await this.git.deleteTag(workspace, name);
    if (remote) await this.git.deleteRemoteTag(workspace, name, remote);
    return local;
  }

  @Post('tags/:name/push')
  async pushTag(
    @Param('name') name: string,
    @Body() body: WorkspaceBody,
  ) {
    requireWorkspace(body.workspace);
    return this.git.pushTag(body.workspace, name, body.remote || 'origin');
  }

  @Get('remotes')
  async remotes(@Query('workspace') workspace: string) {
    requireWorkspace(workspace);
    return this.git.remotes(workspace);
  }

  @Post('remotes')
  async addRemote(@Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    if (!body.name || !body.url) throw new BadRequestException('Remote name and URL are required');
    return this.git.addRemote(body.workspace, body.name, body.url);
  }

  @Put('remotes/:name')
  async setRemote(@Param('name') name: string, @Body() body: WorkspaceBody) {
    requireWorkspace(body.workspace);
    if (!body.url) throw new BadRequestException('A remote URL is required');
    return this.git.setRemoteUrl(body.workspace, name, body.url);
  }

  @Delete('remotes/:name')
  async removeRemote(@Param('name') name: string, @Query('workspace') workspace: string) {
    requireWorkspace(workspace);
    return this.git.removeRemote(workspace, name);
  }
}

function requireWorkspace(workspace: string | undefined): asserts workspace is string {
  if (!workspace) throw new BadRequestException('A workspace path is required');
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return 50;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 50;
  return Math.min(500, Math.floor(value));
}
