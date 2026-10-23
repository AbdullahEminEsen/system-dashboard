// Dual-mode: works as a CommonJS module in the main process AND as a plain
// browser script in the renderer (where it sets `window.i18n`).
// This avoids needing `require('./i18n')` in renderers under contextIsolation.

const i18n = {
    tr: {
        // Titlebar
        appName: 'System Dashboard',
        uptime: (h, m) => `${h}s ${m}dk`,

        // Kartlar
        clock: 'Saat',
        cpu: 'CPU',
        ram: 'RAM',
        processes: 'İşlemler',
        processUnit: 'işlem',
        screen: 'Ekran',
        disk: 'Disk',
        diskFree: (n) => `Boş: ${n} GB`,
        net: 'Ağ',
        download: 'İndirme',
        upload: 'Yükleme',
        gpu: 'GPU',
        vramUsed: 'Kullanılan VRAM',
        usage: 'Kullanım',
        temp: 'Sıcaklık',
        memUsage: 'Bellek Yükü',
        power: 'Güç',
        coreClock: 'Çekirdek',
        fan: 'Fan',
        throttle: 'Kısma',
        throttleNone: 'Yok',
        throttleIdle: 'Boşta',
        throttlePower: 'Güç limiti',
        throttleThermal: 'Termal',
        throttleOther: 'Diğer',
        gpuProcesses: 'GPU İşlemleri',
        gpuProcEmpty: 'GPU kullanan işlem yok',
        gpuProcUnavailable: 'Native eklenti gerekli',
        gpuProcLoading: 'GPU sayaçları hazırlanıyor…',
        vramHigh: 'VRAM dolmak üzere',
        vramAlertTitle: 'VRAM neredeyse dolu',
        vramAlertBody: (pct, used, total, top) => `%${pct} kullanımda (${used} / ${total} MB).` + (top ? ` En çok: ${top}` : ''),

        // Settings
        settings: 'Ayarlar',
        appearance: 'Görünüm',
        theme: 'Tema',
        themeLight: 'Aydınlık mod',
        themeDark: 'Karanlık mod',
        size: 'Boyut',
        sizeDesc: 'Widget büyüklüğü',
        opacity: 'Saydamlık',
        behavior: 'Davranış',
        alwaysOnTop: 'Her zaman üstte',
        alwaysOnTopDesc: 'Oyunlarda da görünür',
        refreshRate: 'Yenileme hızı',
        refreshRateDesc: (s) => `Her ${s} sn`,
        language: 'Dil',

        // Editor
        editor: 'Kartları Düzenle',
        visibleCards: 'Görünen Kartlar',
        hiddenCards: 'Gizli Kartlar',
        editorHint: 'Kartları sürükleyerek sırala — göz ikonuyla gizle/göster',
        hiddenHint: 'Gizli kartları tekrar eklemek için + butonuna tıkla',
        addCard: '+ Ekle',
        allVisible: 'Tüm kartlar görünüyor',
        group: (n) => `Grup (${n} kart)`,
        groupAction: 'Grupla',
        addToGroup: 'Ekle',
        groupHint: (label) => `"${label}" ile gruplamak istediğin karta tıkla`,

        // Tray
        showHide: 'Göster / Gizle',
        quit: 'Çıkış',
    },

    en: {
        // Titlebar
        appName: 'System Dashboard',
        uptime: (h, m) => `${h}h ${m}m`,

        // Kartlar
        clock: 'Clock',
        cpu: 'CPU',
        ram: 'RAM',
        processes: 'Processes',
        processUnit: 'processes',
        screen: 'Display',
        disk: 'Disk',
        diskFree: (n) => `Free: ${n} GB`,
        net: 'Network',
        download: 'Download',
        upload: 'Upload',
        gpu: 'GPU',
        vramUsed: 'VRAM Used',
        usage: 'Usage',
        temp: 'Temp',
        memUsage: 'Mem Usage',
        power: 'Power',
        coreClock: 'Core',
        fan: 'Fan',
        throttle: 'Throttle',
        throttleNone: 'None',
        throttleIdle: 'Idle',
        throttlePower: 'Power limit',
        throttleThermal: 'Thermal',
        throttleOther: 'Other',
        gpuProcesses: 'GPU Processes',
        gpuProcEmpty: 'No process is using the GPU',
        gpuProcUnavailable: 'Requires the native add-on',
        gpuProcLoading: 'Preparing GPU counters…',
        vramHigh: 'VRAM almost full',
        vramAlertTitle: 'VRAM almost full',
        vramAlertBody: (pct, used, total, top) => `${pct}% in use (${used} / ${total} MB).` + (top ? ` Top: ${top}` : ''),

        // Settings
        settings: 'Settings',
        appearance: 'Appearance',
        theme: 'Theme',
        themeLight: 'Light mode',
        themeDark: 'Dark mode',
        size: 'Size',
        sizeDesc: 'Widget scale',
        opacity: 'Opacity',
        behavior: 'Behavior',
        alwaysOnTop: 'Always on top',
        alwaysOnTopDesc: 'Visible over games too',
        refreshRate: 'Refresh rate',
        refreshRateDesc: (s) => `Every ${s}s`,
        language: 'Language',

        // Editor
        editor: 'Card Editor',
        visibleCards: 'Visible Cards',
        hiddenCards: 'Hidden Cards',
        editorHint: 'Drag to reorder — toggle visibility with eye icon',
        hiddenHint: 'Click + to re-add hidden cards',
        addCard: '+ Add',
        allVisible: 'All cards are visible',
        group: (n) => `Group (${n} cards)`,
        groupAction: 'Group',
        addToGroup: 'Add',
        groupHint: (label) => `Select a card to group with "${label}"`,

        // Tray
        showHide: 'Show / Hide',
        quit: 'Quit',
    }
}

if (typeof module !== 'undefined' && module.exports) module.exports = i18n
if (typeof window !== 'undefined') window.i18n = i18n
