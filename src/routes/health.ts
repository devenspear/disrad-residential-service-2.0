import { Router, Request, Response } from 'express';
import os from 'os';

const router = Router();
const startTime = Date.now();

router.get('/', (_req: Request, res: Response) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);

  res.json({
    status: 'healthy',
    uptime,
    uptimeFormatted: formatUptime(uptime),
    version: process.env.npm_package_version || '1.0.0',
    timestamp: new Date().toISOString(),
    system: {
      platform: os.platform(),
      hostname: os.hostname(),
      memory: {
        total: Math.round(os.totalmem() / 1024 / 1024) + 'MB',
        free: Math.round(os.freemem() / 1024 / 1024) + 'MB',
        usage: Math.round((1 - os.freemem() / os.totalmem()) * 100) + '%',
      },
      cpu: os.cpus()[0]?.model || 'Unknown',
    },
  });
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(' ');
}

export default router;
