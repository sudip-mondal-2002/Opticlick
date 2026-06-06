/**
 * evals/recorder.ts
 *
 * ffmpeg/ffprobe wrappers for:
 *  - Compressing the raw Playwright WebM into a smaller MP4
 *  - Extracting N evenly-spaced frames as base64 PNGs for the judge LLM
 *  - Getting video duration via ffprobe
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';

const FRAMES_DIR = path.resolve(process.cwd(), 'evals/results/frames');

/**
 * Compress a WebM video to a smaller MP4.
 * - 2fps (sufficient for agent evals, dramatically reduces size)
 * - 720p
 * - CRF 28 (good compression, acceptable quality for vision LLM)
 * - No audio
 */
export function compressVideo(inputPath: string, outputPath: string): void {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Video not found: ${inputPath}`);
  }

  const result = spawnSync(
    'ffmpeg',
    [
      '-y',                   // overwrite output if exists
      '-i', inputPath,
      '-vf', 'scale=1280:720',
      '-r', '2',              // 2 fps
      '-c:v', 'libx264',
      '-crf', '28',
      '-preset', 'fast',
      '-an',                  // no audio
      outputPath,
    ],
    { stdio: 'pipe' },
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() ?? '';
    throw new Error(`ffmpeg compression failed:\n${stderr}`);
  }
}

/**
 * Get video duration in seconds using ffprobe.
 * Returns 0 if ffprobe fails (non-fatal).
 */
export function getVideoDuration(videoPath: string): number {
  if (!fs.existsSync(videoPath)) return 0;

  const result = spawnSync(
    'ffprobe',
    [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      videoPath,
    ],
    { stdio: 'pipe' },
  );

  try {
    const json = JSON.parse(result.stdout?.toString() ?? '{}');
    const duration = parseFloat(json.streams?.[0]?.duration ?? '0');
    return isNaN(duration) ? 0 : duration;
  } catch {
    return 0;
  }
}

/**
 * Extract N evenly-spaced frames from an MP4 as base64-encoded PNG strings.
 * Max frames is capped at maxFrames (default 15) to control LLM token cost.
 *
 * Returns array of base64 strings (no data-URL prefix).
 */
export function extractFrames(
  videoPath: string,
  caseId: string,
  maxFrames = 15,
): string[] {
  if (!fs.existsSync(videoPath)) return [];

  const caseFramesDir = path.join(FRAMES_DIR, caseId);
  fs.mkdirSync(caseFramesDir, { recursive: true });

  // Get total frame count first
  const countResult = spawnSync(
    'ffprobe',
    [
      '-v', 'quiet',
      '-select_streams', 'v:0',
      '-count_frames',
      '-show_entries', 'stream=nb_read_frames',
      '-print_format', 'json',
      videoPath,
    ],
    { stdio: 'pipe' },
  );

  let totalFrames = 60; // fallback
  try {
    const json = JSON.parse(countResult.stdout?.toString() ?? '{}');
    const nb = parseInt(json.streams?.[0]?.nb_read_frames ?? '0', 10);
    if (nb > 0) totalFrames = nb;
  } catch {
    // use fallback
  }

  // Calculate step so we extract exactly maxFrames (or fewer if video is short)
  const frameStep = Math.max(1, Math.floor(totalFrames / maxFrames));

  // Extract frames using select filter
  const outputPattern = path.join(caseFramesDir, 'frame_%04d.png');
  const extractResult = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i', videoPath,
      '-vf', `select=not(mod(n\\,${frameStep}))`,
      '-vsync', '0',
      '-q:v', '2',
      outputPattern,
    ],
    { stdio: 'pipe' },
  );

  if (extractResult.status !== 0) {
    console.warn(`[recorder] Frame extraction failed for ${caseId}`);
    return [];
  }

  // Read extracted PNG files and encode as base64
  const frameFiles = fs
    .readdirSync(caseFramesDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .slice(0, maxFrames); // cap at maxFrames

  return frameFiles.map((f) => {
    const buf = fs.readFileSync(path.join(caseFramesDir, f));
    return buf.toString('base64');
  });
}

/** Clean up extracted frames for a case (call after judging). */
export function cleanupFrames(caseId: string): void {
  const caseFramesDir = path.join(FRAMES_DIR, caseId);
  if (fs.existsSync(caseFramesDir)) {
    fs.rmSync(caseFramesDir, { recursive: true, force: true });
  }
}
