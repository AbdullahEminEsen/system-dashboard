// preload.js — exposes a minimal, channel-allowlisted IPC surface to renderers.
// Loaded with contextIsolation:true and nodeIntegration:false in BrowserWindow.

const { contextBridge, ipcRenderer } = require('electron')

// Channels the renderer is allowed to call/listen on.
// invoke = main has ipcMain.handle (returns a value); send = main has ipcMain.on (fire-and-forget).
const ALLOW_INVOKE = new Set([
    'get-theme',
    'get-lang',
    'get-layout',
    'get-visible',
    'get-always-on-top',
    'get-opacity',
    'get-gpu-list', 'get-display-list',
    'get-selected-gpu',
    'get-selected-display',
    'get-benchmark-sample',
    'save-benchmark-report',
])

const ALLOW_SEND = new Set([
    'set-theme', 'set-lang', 'set-layout', 'set-visible',
    'set-always-on-top', 'set-opacity',
    'set-selected-gpu', 'set-selected-display',
    'set-window-height',
    'open-editor', 'close-editor',
    'open-settings', 'close-settings',
    'open-benchmark', 'close-benchmark',
    'hide-app', 'close-app',
])

const ALLOW_ON = new Set([
    'theme-changed',
    'lang-changed',
    'layout-updated',
    'visible-updated',
    'system-update',
])

contextBridge.exposeInMainWorld('api', {
    invoke: (channel, ...args) => {
        if (!ALLOW_INVOKE.has(channel)) {
            return Promise.reject(new Error('invoke channel not allowed: ' + channel))
        }
        return ipcRenderer.invoke(channel, ...args)
    },
    send: (channel, ...args) => {
        if (!ALLOW_SEND.has(channel)) {
            console.warn('send channel not allowed:', channel)
            return
        }
        ipcRenderer.send(channel, ...args)
    },
    on: (channel, listener) => {
        if (!ALLOW_ON.has(channel)) {
            console.warn('on channel not allowed:', channel)
            return () => {}
        }
        const wrapped = (_event, ...args) => listener(...args)
        ipcRenderer.on(channel, wrapped)
        return () => ipcRenderer.removeListener(channel, wrapped)
    },
})
