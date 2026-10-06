import { desktopCapturer, session } from 'electron';

/**
 * Wires up permissions and system-audio capture.
 *
 * On Windows, getDisplayMedia() from the renderer is answered with the primary
 * screen plus `audio: 'loopback'`, which captures the WASAPI loopback of the
 * default output device: everything Serato, Rekordbox, Spotify etc. play, with
 * no drivers. The renderer stops the video track immediately.
 */
export function installCaptureHandlers(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture' || permission === 'fullscreen' || permission === 'midi' || permission === 'midiSysex');
  });
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'midi' || permission === 'fullscreen');

  ses.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length) {
          callback({});
          return;
        }
        if (process.platform === 'win32') {
          callback({ video: sources[0], audio: 'loopback' });
        } else {
          // Loopback capture is Windows-only in Electron; the renderer detects
          // the missing audio track and points the user at BlackHole/virtual cables.
          callback({ video: sources[0] });
        }
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false },
  );
}
