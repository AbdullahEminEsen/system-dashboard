// editor.js — runs under contextIsolation:true.
// IPC via window.api, i18n via window.i18n.
// Wrapped in an IIFE so top-level bindings (api, t, layout, …) stay private to
// this script and can't collide with another script sharing the page's global
// scope. Without it, `const api` collided with an existing global `api`, throwing
// "Identifier 'api' has already been declared" at parse time — which is why the
// whole file never ran and the editor came up completely blank.
;(() => {
const api = window.api
const i18nRef = window.i18n
let currentLang = 'tr'
let t = i18nRef[currentLang]

async function initLang() {
  currentLang = await api.invoke('get-lang')
  t = i18nRef[currentLang]
}

api.on('lang-changed', (lang) => {
  currentLang = lang
  t = i18nRef[lang]
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
  }
}

let layout = []
let groupingCardId = null

function getAllVisible() {
  const ids = []
  layout.forEach(slot => {
    if (!slot || typeof slot !== 'object') return
    if (slot.type === 'single') ids.push(slot.id)
    else if (Array.isArray(slot.children)) slot.children.forEach(c => ids.push(c))
  })
  return ids
}

function getHidden() {
  const CARD_DEFS = getCardDefs()
  const vis = getAllVisible()
  return Object.keys(CARD_DEFS).filter(id => !vis.includes(id))
}

function saveAndSync() {
  api.send('set-layout', layout)
  api.send('set-visible', getAllVisible())
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
    // Guard against malformed slots. Anything that isn't a valid single or a
    // group with a real children array is skipped rather than crashing the whole
    // render (which previously left the editor completely blank).
    if (!slot || typeof slot !== 'object') return
    const isGroup = slot.type === 'group' && Array.isArray(slot.children)
    if (slot.type !== 'single' && !isGroup) return

    const el = document.createElement('div')
    el.className = `slot${isGroup ? ' group' : ''}`
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
                     ${t.groupAction}
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
                   ${t.addToGroup}
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

  // Gruplama banner
  const hint = document.getElementById('groupHint')
  if (groupingCardId) {
    if (!hint) {
      const CARD_DEFS = getCardDefs()
      const banner = document.createElement('div')
      banner.id = 'groupHint'
      banner.style.cssText = 'background:#1e3a5f;border:1px solid #3b82f6;border-radius:8px;padding:8px 12px;font-size:12px;color:#60a5fa;text-align:center;margin-top:4px'
      const label = CARD_DEFS[groupingCardId]?.label || ''
      banner.textContent = t.groupHint(label)
      document.getElementById('slotList').after(banner)
    }
  } else {
    if (hint) hint.remove()
  }

  lucide.createIcons()
  initSlotSortable()
  initChildSortables()
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
    Sortable.create(container, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      group: 'children',
      onEnd: (evt) => {
        const fromSlot = parseInt(evt.from.id.split('-')[1], 10)
        const toSlot = parseInt(evt.to.id.split('-')[1], 10)
        const movedId = evt.item.dataset.id
        if (!layout[fromSlot] || layout[fromSlot].type !== 'group') return

        if (fromSlot === toSlot) {
          // Reorder within the same group — move inside its children array.
          // (The old code always ran the "collapse if length===1" branch here,
          // which destroyed a two-card group whenever you reordered its cards.)
          const children = layout[fromSlot].children
          children.splice(evt.oldIndex, 1)
          children.splice(evt.newIndex, 0, movedId)
        } else {
          // Cross-group move. Grab the target group by reference *before*
          // mutating the source, so collapsing/removing the source slot can't
          // shift the target index out from under us (the old adjustedTo math
          // assumed the source was always spliced out, which isn't true when it
          // collapses to a single in place).
          const targetGroup = layout[toSlot]
          if (!targetGroup || targetGroup.type !== 'group') return
          targetGroup.children.splice(evt.newIndex, 0, movedId)

          const src = layout[fromSlot]
          src.children.splice(evt.oldIndex, 1)
          if (src.children.length === 1) {
            layout[fromSlot] = { id: src.children[0], type: 'single' }
          } else if (src.children.length === 0) {
            layout.splice(fromSlot, 1)
          }
        }

        saveAndSync()
        renderSlotList()
        renderHiddenPool()
      }
    })
  })
}

// Single delegated click handler — survives re-renders without rebinding.
document.addEventListener('click', (e) => {
  const target = e.target
  if (!target || !target.closest) return

  const groupBtn = target.closest('.group-btn')
  if (groupBtn) { groupingCardId = groupBtn.dataset.id; renderSlotList(); return }

  const cancelBtn = target.closest('.cancel-group-btn')
  if (cancelBtn) { groupingCardId = null; renderSlotList(); return }

  const mergeBtn = target.closest('.merge-btn')
  if (mergeBtn) { groupCards(mergeBtn.dataset.source, mergeBtn.dataset.target); return }

  const hideBtn = target.closest('.hide-btn')
  if (hideBtn) {
    const idx = parseInt(hideBtn.dataset.idx, 10)
    layout.splice(idx, 1)
    groupingCardId = null
    saveAndSync()
    renderSlotList()
    renderHiddenPool()
    return
  }

  const ungroupBtn = target.closest('.ungroup-btn')
  if (ungroupBtn) {
    const slotIdx = parseInt(ungroupBtn.dataset.slot, 10)
    const cardId = ungroupBtn.dataset.id
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
    return
  }

  const addBtn = target.closest('.add-btn')
  if (addBtn) {
    layout.push({ id: addBtn.dataset.id, type: 'single' })
    saveAndSync()
    renderSlotList()
    renderHiddenPool()
    return
  }
})

api.on('theme-changed', (theme) => {
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
    api.invoke('get-layout'),
    api.invoke('get-visible'),
    api.invoke('get-theme')
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
  api.send('close-editor')
})

})()
