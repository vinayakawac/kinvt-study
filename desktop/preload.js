/*
 * Deliberately exposes the same `window.__TAURI__` shape the Tauri build
 * provides, so ui/ (app.js, settings.js) runs unmodified under either shell.
 * The alternative — branching on the runtime inside the UI — would mean two
 * code paths through the part of the app users actually see.
 *
 * contextIsolation is on, so this bridge is the only surface the renderer
 * gets: no Node, no filesystem, no arbitrary IPC.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED = ['show_quiz', 'hide_quiz', 'resize_quiz', 'open_settings'];

contextBridge.exposeInMainWorld('__TAURI__', {
  core: {
    invoke: (cmd, args) => {
      if (!ALLOWED.includes(cmd)) {
        return Promise.reject(new Error('blocked command: ' + cmd));
      }
      return ipcRenderer.invoke(cmd, args || {});
    }
  },
  event: {
    listen: (name, cb) => {
      const handler = (_e, payload) => cb({ payload });
      ipcRenderer.on(name, handler);
      return Promise.resolve(() => ipcRenderer.removeListener(name, handler));
    },
    // Routed through the main process rather than an in-page bus: the
    // settings window and the quiz card are separate renderers and cannot
    // hear each other directly.
    emit: (name) => ipcRenderer.invoke('emit', name)
  }
});
