import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../../src/server/videos/video-transcode-queue';

describe('buildFfmpegArgs', () => {
  it('长边压到 1280、CRF 28、veryfast，音频降到 128k AAC', () => {
    const args = buildFfmpegArgs('/data/product-videos/a.mp4', '/data/product-videos/a.mp4.transcoding.mp4');
    expect(args).toContain('-i');
    expect(args[args.indexOf('-i') + 1]).toBe('/data/product-videos/a.mp4');
    // 长边 1280、小的不放大：scale='min(1280,iw)':-2 保持宽高比。
    expect(args[args.indexOf('-vf') + 1]).toBe("scale='min(1280,iw)':-2");
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-crf') + 1]).toBe('28');
    expect(args[args.indexOf('-preset') + 1]).toBe('veryfast');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.indexOf('-b:a') + 1]).toBe('128k');
  });

  it('输出路径是最后一个参数，且带 -y 覆盖已存在的临时文件', () => {
    const args = buildFfmpegArgs('in.mp4', 'out.mp4');
    expect(args[0]).toBe('-y');
    expect(args[args.length - 1]).toBe('out.mp4');
  });

  it('faststart 让 moov 前置，详情页点开能边下边播', () => {
    const args = buildFfmpegArgs('in.mp4', 'out.mp4');
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
  });
});
