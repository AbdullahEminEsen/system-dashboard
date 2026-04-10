const { ipcRenderer } = require('electron')

const i18n = require('./i18n')
let currentLang = 'tr'
let t = i18n[currentLang]

async function initLang() {
  currentLang = await ipcRenderer.invoke('get-lang')
  t = i18n[currentLang]
}

ipcRenderer.on('lang-changed', (_, lang) => {
  currentLang = lang
  t = i18n[lang]
  updateEditorUI()
  renderSlotList()
  renderHiddenPool()
})

function getCardDefs() {
  return {
    'card-clock': { label: t.clock, icon: 'clock-3', single: true },
    'card-cpu': { label: t.cpu, icon: 'cpu', single: false },
    'card-ram': { label: t.ram, icon: 'memory-stick', single: false },
    'card-gpu': { label: t.gpu, icon: 'monitor-check', single: true },
    'card-proc': { label: t.processes, icon: 'layers', single: false },
    'card-screen': { label: t.screen, icon: 'monitor', single: false },
    'card-disk': { label: t.disk, icon: 'hard-drive', single: true },
    'card-net': { label: t.net, icon: 'wifi', single: true },
    'card-weather': { label: t.weather, icon: 'map-pin', single: true },
  }
}

let layout = []
let groupingCardId = null

function getAllVisible() {
  const ids = []
  layout.forEach(slot => {
    if (slot.type === 'single') ids.push(slot.id)
    else slot.children.forEach(c => ids.push(c))
  })
  return ids
}

function getHidden() {
  const CARD_DEFS = getCardDefs()
  const vis = getAllVisible()
  return Object.keys(CARD_DEFS).filter(id => !vis.includes(id))
}

function saveAndSync() {
  ipcRenderer.send('set-layout', layout)
  ipcRenderer.send('set-visible', getAllVisible())
}

function groupCards(sourceId, targetId) {
  const sourceSlotIdx = layout.findIndex(s =>
    s.type === 'single' ? s.id === sourceId : s.children?.includes(sourceId)
  )
  const targetSlotIdx = layout.findIndex(s =>
    s.type === 'single' ? s.id === targetId : s.children?.includes(targetId)
  )
  if (sourceSlotIdx === -1 || targetSlotIdx === -1 || sourceSlotIdx === targetSlotIdx) return

  const targetSlot = layout[targetSlotIdx]

  if (targetSlot.type === 'single') {
    layout[targetSlotIdx] = { id: `group-${Date.now()}`, type: 'group', children: [targetId, sourceId] }
  } else if (targetSlot.type === 'group' && targetSlot.children.length < 3) {
    targetSlot.children.push(sourceId)
  } else {
    return
  }

  if (layout[sourceSlotIdx].type === 'single') {
    layout.splice(sourceSlotIdx, 1)
  } else {
    layout[sourceSlotIdx].children = layout[sourceSlotIdx].children.filter(c => c !== sourceId)
    if (layout[sourceSlotIdx].children.length === 1) {
      const remaining = layout[sourceSlotIdx].children[0]
      layout[sourceSlotIdx] = { id: remaining, type: 'single' }
    } else if (layout[sourceSlotIdx].children.length === 0) {
      layout.splice(sourceSlotIdx, 1)
    }
  }

  saveAndSync()
  groupingCardId = null
  renderSlotList()
  renderHiddenPool()
}

function renderSlotList() {
  const CARD_DEFS = getCardDefs()
  const list = document.getElementById('slotList')
  list.innerHTML = ''

  layout.forEach((slot, slotIdx) => {
    const el = document.createElement('div')
    el.className = `slot${slot.type === 'group' ? ' group' : ''}`
    el.dataset.idx = slotIdx

    if (slot.type === 'single') {
      const def = CARD_DEFS[slot.id]
      if (!def) return
      const isGroupingSource = groupingCardId === slot.id
      const isGroupingTarget = groupingCardId && groupingCardId !== slot.id

      el.innerHTML = `
        <div class="slot-handle ${isGroupingTarget ? 'group-target' : ''}">
          <div class="slot-handle-left">
            <i data-lucide="grip-vertical" style="width:12px;height:12px;color:var(--text-muted)"></i>
            <i data-lucide="${def.icon}" style="width:13px;height:13px;color:var(--text-muted)"></i>
            <span class="slot-label">${def.label}</span>
          </div>
          <div class="slot-actions">
            ${isGroupingSource
          ? `<button class="icon-btn active cancel-group-btn" title="Cancel">
                   <i data-lucide="x" style="width:13px;height:13px"></i>
                 </button>`
          : isGroupingTarget
            ? `<button class="icon-btn merge-btn" data-source="${groupingCardId}" data-target="${slot.id}" style="color:#3b82f6;border:1px solid #3b82f6;border-radius:6px;padding:2px 8px;font-size:11px">
                     ${currentLang === 'tr' ? 'Grupla' : 'Group'}
                   </button>`
            : `<button class="icon-btn group-btn" data-id="${slot.id}">
                     <i data-lucide="layout-panel-left" style="width:13px;height:13px"></i>
                   </button>
                   <button class="icon-btn danger hide-btn" data-idx="${slotIdx}">
                     <i data-lucide="eye-off" style="width:13px;height:13px"></i>
                   </button>`
        }
          </div>
        </div>`
    } else {
      const childrenHTML = slot.children.map((c) => {
        const def = CARD_DEFS[c]
        if (!def) return ''
        return `
          <div class="child-item" data-id="${c}" data-slot="${slotIdx}">
            <div class="child-left">
              <i data-lucide="grip-vertical" style="width:11px;height:11px;color:var(--text-muted)"></i>
              <i data-lucide="${def.icon}" style="width:12px;height:12px;color:var(--text-muted)"></i>
              <span>${def.label}</span>
            </div>
            <button class="icon-btn danger ungroup-btn" data-slot="${slotIdx}" data-id="${c}">
              <i data-lucide="x" style="width:11px;height:11px"></i>
            </button>
          </div>`
      }).join('')

      const canMerge = groupingCardId && slot.children.length < 3
      el.innerHTML = `
        <div class="slot-handle">
          <div class="slot-handle-left">
            <i data-lucide="grip-vertical" style="width:12px;height:12px;color:var(--text-muted)"></i>
            <i data-lucide="layout-panel-left" style="width:13px;height:13px;color:#3b82f6"></i>
            <span class="slot-label" style="color:#3b82f6">${t.group(slot.children.length)}</span>
          </div>
          <div class="slot-actions">
            ${canMerge
          ? `<button class="icon-btn merge-btn" data-source="${groupingCardId}" data-target="${slot.children[0]}" style="color:#3b82f6;border:1px solid #3b82f6;border-radius:6px;padding:2px 8px;font-size:11px">
                   ${currentLang === 'tr' ? 'Ekle' : 'Add'}
                 </button>`
          : `<button class="icon-btn danger hide-btn" data-idx="${slotIdx}">
                   <i data-lucide="eye-off" style="width:13px;height:13px"></i>
                 </button>`
        }
          </div>
        </div>
        <div class="slot-children" id="children-${slotIdx}">${childrenHTML}</div>`
    }

    list.appendChild(el)
  })

  // Gruplama banner'ı
  const hint = document.getElementById('groupHint')
  if (groupingCardId) {
    if (!hint) {
      const CARD_DEFS = getCardDefs()
      const banner = document.createElement('div')
      banner.id = 'groupHint'
      banner.style.cssText = 'background:#1e3a5f;border:1px solid #3b82f6;border-radius:8px;padding:8px 12px;font-size:12px;color:#60a5fa;text-align:center;margin-top:4px'
      banner.textContent = currentLang === 'tr'
        ? `"${CARD_DEFS[groupingCardId]?.label}" ile gruplamak istediğin karta tıkla`
        : `Select a card to group with "${CARD_DEFS[groupingCardId]?.label}"`
      document.getElementById('slotList').after(banner)
    }
  } else {
    if (hint) hint.remove()
  }

  lucide.createIcons()
  initSlotSortable()
  initChildSortables()
  bindSlotActions()
}

function renderHiddenPool() {
  const CARD_DEFS = getCardDefs()
  const pool = document.getElementById('hiddenPool')
  const hidden = getHidden()
  if (hidden.length === 0) {
    pool.innerHTML = `<div class="hint">${t.allVisible}</div>`
    return
  }
  pool.innerHTML = hidden.map(id => {
    const def = CARD_DEFS[id]
    if (!def) return ''
    return `
      <div class="pool-item" data-id="${id}">
        <div style="display:flex;align-items:center;gap:8px">
          <i data-lucide="${def.icon}" style="width:13px;height:13px"></i>
          <span>${def.label}</span>
        </div>
        <button class="add-btn" data-id="${id}">${t.addCard}</button>
      </div>`
  }).join('')
  lucide.createIcons()

  pool.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      layout.push({ id: btn.dataset.id, type: 'single' })
      saveAndSync()
      renderSlotList()
      renderHiddenPool()
    })
  })
}

function initSlotSortable() {
  Sortable.create(document.getElementById('slotList'), {
    animation: 150,
    handle: '.slot-handle',
    ghostClass: 'sortable-ghost',
    onEnd: (evt) => {
      const moved = layout.splice(evt.oldIndex, 1)[0]
      layout.splice(evt.newIndex, 0, moved)
      saveAndSync()
      renderSlotList()
      renderHiddenPool()
    }
  })
}

function initChildSortables() {
  document.querySelectorAll('[id^="children-"]').forEach(container => {
    const slotIdx = parseInt(container.id.split('-')[1])
    Sortable.create(container, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      group: 'children',
      onEnd: (evt) => {
        const fromSlot = parseInt(evt.from.id.split('-')[1])
        const toSlot = parseInt(evt.to.id.split('-')[1])
        const movedId = evt.item.dataset.id

        layout[fromSlot].children.splice(evt.oldIndex, 1)

        if (layout[fromSlot].children.length === 1) {
          const remaining = layout[fromSlot].children[0]
          layout[fromSlot] = { id: remaining, type: 'single' }
        } else if (layout[fromSlot].children.length === 0) {
          layout.splice(fromSlot, 1)
        }

        const adjustedTo = fromSlot < toSlot ? toSlot - 1 : toSlot
        if (layout[adjustedTo] && layout[adjustedTo].type === 'group') {
          layout[adjustedTo].children.splice(evt.newIndex, 0, movedId)
        } else {
          layout.splice(adjustedTo + 1, 0, { id: movedId, type: 'single' })
        }

        saveAndSync()
        renderSlotList()
        renderHiddenPool()
      }
    })
  })
}

function bindSlotActions() {
  document.querySelectorAll('.group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      groupingCardId = btn.dataset.id
      renderSlotList()
    })
  })

  document.querySelectorAll('.cancel-group-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      groupingCardId = null
      renderSlotList()
    })
  })

  document.querySelectorAll('.merge-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      groupCards(btn.dataset.source, btn.dataset.target)
    })
  })

  document.querySelectorAll('.hide-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx)
      layout.splice(idx, 1)
      groupingCardId = null
      saveAndSync()
      renderSlotList()
      renderHiddenPool()
    })
  })

  document.querySelectorAll('.ungroup-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const slotIdx = parseInt(btn.dataset.slot)
      const cardId = btn.dataset.id
      layout[slotIdx].children = layout[slotIdx].children.filter(c => c !== cardId)
      if (layout[slotIdx].children.length === 1) {
        const remaining = layout[slotIdx].children[0]
        layout[slotIdx] = { id: remaining, type: 'single' }
      } else if (layout[slotIdx].children.length === 0) {
        layout.splice(slotIdx, 1)
      }
      layout.push({ id: cardId, type: 'single' })
      groupingCardId = null
      saveAndSync()
      renderSlotList()
      renderHiddenPool()
    })
  })
}

ipcRenderer.on('theme-changed', (_, theme) => {
  document.body.classList.toggle('light', theme === 'light')
})

function updateEditorUI() {
  document.querySelector('.titlebar h1').textContent = t.editor
  const sectionLabels = document.querySelectorAll('.section-label')
  if (sectionLabels[0]) sectionLabels[0].textContent = t.visibleCards
  if (sectionLabels[1]) sectionLabels[1].textContent = t.hiddenCards
  const hint = document.querySelector('.hint')
  if (hint) hint.textContent = t.hiddenHint
}

async function init() {
  const [l, , theme] = await Promise.all([
    ipcRenderer.invoke('get-layout'),
    ipcRenderer.invoke('get-visible'),
    ipcRenderer.invoke('get-theme')
  ])
  await initLang()
  layout = JSON.parse(JSON.stringify(l))
  document.body.classList.toggle('light', theme === 'light')
  updateEditorUI()
  renderSlotList()
  renderHiddenPool()
}
init()

document.getElementById('closeBtn').addEventListener('click', () => {
  ipcRenderer.send('close-editor')
})