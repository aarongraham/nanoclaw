/**
 * Voice message transcription via whisper.cpp.
 *
 * Two entry points:
 *   - `transcribeAudioBuffer(buffer)` — when the caller already has the raw
 *     audio bytes (preferred, avoids re-downloading).
 *   - `transcribeAudioMessage(msg, sock)` — download + transcribe in one step;
 *     kept for callers that don't already have the buffer.
 *
 * Requires `ffmpeg` + `whisper-cli` binaries on PATH and a ggml model file
 * at `$WHISPER_MODEL` (default `data/models/ggml-base.bin`).
 */
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { downloadMediaMessage, WAMessage, WASocket } from '@whiskeysockets/baileys';

import { log } from './log.js';

const execFileAsync = promisify(execFile);

const WHISPER_BIN = process.env.WHISPER_BIN || 'whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL || path.join(process.cwd(), 'data', 'models', 'ggml-base.bin');

const FALLBACK_MESSAGE = '[Voice Message - transcription unavailable]';

async function transcribeWithWhisperCpp(audioBuffer: Buffer): Promise<string | null> {
  const tmpDir = os.tmpdir();
  const id = `nanoclaw-voice-${Date.now()}`;
  const tmpOgg = path.join(tmpDir, `${id}.ogg`);
  const tmpWav = path.join(tmpDir, `${id}.wav`);

  try {
    fs.writeFileSync(tmpOgg, audioBuffer);

    // Convert ogg/opus to 16kHz mono WAV (required by whisper.cpp)
    await execFileAsync('ffmpeg', ['-i', tmpOgg, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', tmpWav], {
      timeout: 30_000,
    });

    const { stdout } = await execFileAsync(WHISPER_BIN, ['-m', WHISPER_MODEL, '-f', tmpWav, '--no-timestamps', '-nt'], {
      timeout: 60_000,
    });

    const transcript = stdout.trim();
    return transcript || null;
  } catch (err) {
    log.warn('whisper.cpp transcription failed', { err });
    return null;
  } finally {
    for (const f of [tmpOgg, tmpWav]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* best effort cleanup */
      }
    }
  }
}

/** Transcribe a pre-downloaded audio buffer. Returns transcript or null on failure. */
export async function transcribeAudioBuffer(buffer: Buffer): Promise<string | null> {
  if (!buffer || buffer.length === 0) return null;
  const transcript = await transcribeWithWhisperCpp(buffer);
  return transcript ? transcript.trim() : null;
}

/** Download + transcribe. Returns transcript, fallback placeholder, or null on hard failure. */
export async function transcribeAudioMessage(msg: WAMessage, sock: WASocket): Promise<string | null> {
  try {
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: console as unknown as never,
        reuploadRequest: sock.updateMediaMessage,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) {
      log.warn('Failed to download audio message (empty buffer)');
      return FALLBACK_MESSAGE;
    }

    log.info('Downloaded audio message for transcription', { bytes: buffer.length });
    const transcript = await transcribeAudioBuffer(buffer);
    if (!transcript) return FALLBACK_MESSAGE;
    log.info('Transcribed voice message', { chars: transcript.length });
    return transcript;
  } catch (err) {
    log.warn('Transcription error', { err });
    return FALLBACK_MESSAGE;
  }
}

export function isVoiceMessage(msg: WAMessage): boolean {
  return msg.message?.audioMessage?.ptt === true;
}
