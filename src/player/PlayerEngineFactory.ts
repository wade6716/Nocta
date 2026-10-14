import { IPlayerEngine } from './types';
import { MpvPlayerEngine } from './MpvPlayerEngine';
import { Html5PlayerEngine } from './Html5PlayerEngine';
import { isTauriEnvironment } from '../api/http';

export type PlayerEngineType = 'mpv' | 'html5';

export class PlayerEngineFactory {
  static create(preferredEngine: PlayerEngineType = 'mpv'): IPlayerEngine {
    if (isTauriEnvironment() && preferredEngine === 'mpv') {
      return new MpvPlayerEngine();
    }
    return new Html5PlayerEngine();
  }
}
