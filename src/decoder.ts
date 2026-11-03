import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';

/**
 * Décodeur H.264 → JPEG basé sur ffmpeg.
 *
 * Ultracam Studio ne réimplémente pas un décodeur vidéo : il s'appuie sur
 * l'exécutable `ffmpeg` (présent dans l'environnement de l'utilisateur).
 * Le flux H.264 Annex B produit par le téléphone est écrit sur l'entrée
 * standard ; ffmpeg ressort un flux MJPEG lisible par OBS (« Media Source »).
 */
export class FfmpegMjpegDecoder extends EventEmitter {
  private proc: ChildProcess | null = null;
  private readonly buffer: Buffer[] = [];
  private width = 0;
  private height = 0;
  private fps = 30;
  private isReady = false;

  constructor(
    private readonly ffmpegPath: string,
    private readonly onFrame: (jpeg: Buffer) => void
  ) {
    super();
  }

  configure(width: number, height: number, fps: number): void {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.restart();
  }

  private restart(): void {
    this.stop();
    if (!this.ffmpegPath) {
      this.emit('warn', 'ffmpeg introuvable : la prévisualisation JPEG est désactivée');
      return;
    }
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-fflags', 'nobuffer',
      '-flags', 'low_delay',
      '-f', 'h264',
      '-i', 'pipe:0',
      '-an',
      '-vf', `fps=${Math.max(1, Math.min(60, this.fps))}`,
      '-f', 'mjpeg',
      '-q:v', '6',
      'pipe:1',
    ];
    const proc = spawn(this.ffmpegPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    this.isReady = true;

    let pending: Buffer = Buffer.alloc(0);
    proc.stdout?.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      // Un JPEG commence par FFD8 et finit par FFD9.
      for (;;) {
        const start = pending.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) {
          if (pending.length > 4) pending = pending.subarray(pending.length - 1);
          return;
        }
        const end = pending.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) {
          if (start > 0) pending = pending.subarray(start);
          return;
        }
        const frame = pending.subarray(start, end + 2);
        this.onFrame(frame);
        pending = pending.subarray(end + 2);
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line) this.emit('warn', `ffmpeg: ${line.slice(0, 400)}`);
    });

    proc.on('exit', (code) => {
      this.isReady = false;
      if (this.proc === proc && code !== 0) {
        this.emit('warn', `ffmpeg terminé (code ${code})`);
      }
    });
  }

  write(data: Buffer): void {
    if (!this.isReady || !this.proc?.stdin?.writable) {
      return;
    }
    try {
      this.proc.stdin.write(data);
    } catch (err) {
      this.emit('warn', `écriture ffmpeg : ${(err as Error).message}`);
    }
  }

  stop(): void {
    this.isReady = false;
    if (this.proc) {
      try {
        this.proc.stdin?.end();
        this.proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.proc = null;
    }
  }
}
