import { FfmpegMjpegDecoder } from './decoder';
import { MediaSink, SessionInfo, UltracamServer } from './server';

/**
 * Relie le flux H.264 reçu du téléphone à ffmpeg, puis publie les JPEG
 * décodés sur le serveur (`/obs` et `/obs.mjpg` pour OBS « Media Source »).
 */
export function attachMjpegPreview(server: UltracamServer, ffmpegPath: string | null): () => void {
  let decoder: FfmpegMjpegDecoder | null = null;

  const sink: MediaSink = {
    onVideoHeaders(_payload: Uint8Array, session: SessionInfo): void {
      const v = session.video;
      if (!decoder) {
        decoder = new FfmpegMjpegDecoder(ffmpegPath ?? '', (jpeg) => server.setLatestJpeg(jpeg));
        decoder.on('warn', (msg: string) => console.warn(`[preview] ${msg}`));
      }
      if (v) decoder.configure(v.width, v.height, v.fps);
    },
    onVideoConfig(_payload: Uint8Array, session: SessionInfo): void {
      const v = session.video;
      if (v && decoder) decoder.configure(v.width, v.height, v.fps);
    },
    onVideoFrame(_keyframe: boolean, payload: Uint8Array, _session: SessionInfo): void {
      if (!decoder) return;
      // Le téléphone envoie une image H.264 Annex B complète (start code
      // 00 00 00 01 + NAL), donc ffmpeg peut la consommer telle quelle.
      decoder.write(Buffer.from(payload));
    },
  };

  server.setSink(sink);
  return () => {
    decoder?.stop();
    decoder = null;
    server.setSink(null);
  };
}
