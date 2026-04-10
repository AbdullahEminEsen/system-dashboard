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
        vramUsed: 'VRAM Used',
        usage: 'Usage',
        temp: 'Temp',
        memUsage: 'Mem Usage',
        power: 'Power',

        // Hava durumu
        weather: 'Hava Durumu',
        weatherEmpty: 'Hava durumu için\nbir şehir seçin',
        selectCity: 'Şehir Seç',
        citySearch: 'Şehir ara...',
        cityNotFound: 'Şehir bulunamadı',
        humidity: (n) => `Nem %${n}`,
        weatherCodes: {
            0: 'Açık', 1: 'Az bulutlu', 2: 'Parçalı bulutlu', 3: 'Bulutlu',
            45: 'Sisli', 51: 'Çisenti', 61: 'Yağmurlu', 71: 'Karlı',
            80: 'Sağanak', 95: 'Fırtına'
        },

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

        // Hava durumu
        weather: 'Weather',
        weatherEmpty: 'Select a city\nto see weather',
        selectCity: 'Select City',
        citySearch: 'Search city...',
        cityNotFound: 'City not found',
        humidity: (n) => `Humidity ${n}%`,
        weatherCodes: {
            0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy',
            45: 'Foggy', 51: 'Drizzle', 61: 'Rainy', 71: 'Snowy',
            80: 'Showers', 95: 'Thunderstorm'
        },

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

        // Tray
        showHide: 'Show / Hide',
        quit: 'Quit',
    }
}

module.exports = i18n