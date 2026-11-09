/**
 * dsh-sidebar-plugins-toggle — Client 端
 *
 * 在侧边栏「插件」那一行的最右侧挂一个小箭头，用来收起 / 展开它下面那一整块
 * 插件区入口（插件市场、自动化任务、上下文洞察、更多……）。
 *
 *   - 插件区展开时是 ▾，点一下 → 只留「插件」这一行，其余入口收起来；
 *   - 插件区收起时是 ▸，点一下 → 其余入口重新出现。
 *
 * 「插件」这一行本身永远保留，否则箭头会跟着消失、就没法再点回来了。
 * 状态记在 localStorage 里，刷新页面后保持；侧栏折成 56px 轨道时不折叠
 * （轨道里箭头是隐藏的，折叠会变成死路）。
 *
 * 为什么用原生 DOM：侧边栏的每一行由 ui-sidebar 独占渲染，行内只有图标插槽
 * 和标题文字，没有「行尾操作位」插槽。所以这里在该行按钮尾部追加一个宿主
 * 节点，用原生 DOM 画箭头、用属性 + CSS 收起同级入口，再由 MutationObserver
 * 维护（React 重渲染、折叠侧栏、切换语言、面板重新注册都会自动对齐）。
 *
 * 三条硬约束（插件坏掉的代价比没有插件大得多）：
 *   1. 任何路径都不抛错，全部包在 try/catch 里；
 *   2. 找不到那一行就什么都不做，绝不影响界面；
 *   3. 卸载时把自己的节点、样式、属性、监听器全部收干净。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-plugins-toggle',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ── 常量 ────────────────────────────────────────────────────────────

    /** 插件名，与 cordis.patch.yml 里的 id 对应。 */
    const name = 'sidebar-plugins-toggle'

    /** 锚点行的主面板 id（官方 ui-plugin-manager 的 PANEL_ID）。 */
    const PANEL_ID = 'plugins'

    /** 侧边栏行的图标插槽名，用来读出「插件」行当前的语言化标签。 */
    const PANEL_SLOT = 'sidebar.panellist'

    /** 我们追加的宿主节点标记。 */
    const HOST_ATTR = 'data-dsh-pst-host'

    /** 挂在「插件」行上的标记，用来把它从「要收起的同级入口」里排除。 */
    const ROW_ATTR = 'data-dsh-pst-row'

    /** 挂在被收起的同级入口上的标记（CSS 负责 display:none）。 */
    const HIDDEN_ATTR = 'data-dsh-pst-hidden'

    /** 样式标签 id。 */
    const STYLE_ID = 'dsh-sidebar-plugins-toggle-style'

    /** 折叠状态在 localStorage 里的键。 */
    const STORE_KEY = 'dsh-sidebar-plugins-toggle:collapsed'

    /** 读不到注册表时的兜底标签：官方 8 种语言里「插件」行的文案。 */
    const FALLBACK_LABELS = ['插件', 'Plugins', 'プラグイン', 'Complementos', 'Plug-ins', 'Плагины']

    /** 提示文案：跟随客户端当前语言。 */
    const COPY = {
      zh: { expand: '展开插件区', collapse: '收起插件区' },
      en: { expand: 'Expand plugins area', collapse: 'Collapse plugins area' },
      ja: { expand: 'プラグイン領域を開く', collapse: 'プラグイン領域を閉じる' },
      es: { expand: 'Mostrar el área de complementos', collapse: 'Ocultar el área de complementos' },
      fr: { expand: 'Développer la zone Plugins', collapse: 'Réduire la zone Plugins' },
      de: { expand: 'Plugin-Bereich aufklappen', collapse: 'Plugin-Bereich einklappen' },
      ru: { expand: 'Развернуть область плагинов', collapse: 'Свернуть область плагинов' },
      pt: { expand: 'Expandir a área de plugins', collapse: 'Recolher a área de plugins' },
    }

    /** 箭头图标：一个朝右的 <，展开时用 CSS 旋转 90° 变成朝下的 v。 */
    const CHEVRON_SVG =
      '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">' +
      '<path d="M6.4 3.6 10.8 8l-4.4 4.4" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>'

    /** 注入的样式：用 DSH 自己的设计变量，深浅色主题自动跟随。 */
    const CSS = `
[${HOST_ATTR}]{display:inline-flex;align-items:center;justify-content:center;flex:none;align-self:center;margin-inline-start:auto}
[${HOST_ATTR}][hidden]{display:none}
[${HOST_ATTR}] .dsh-pst-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-inline-end:-2px;padding:0;border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,currentColor));cursor:pointer;user-select:none;-webkit-user-select:none;transition:color .12s ease,background-color .12s ease}
[${HOST_ATTR}] .dsh-pst-btn:hover{color:var(--dsw-alias-label-primary);background-color:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.12))}
[${HOST_ATTR}] .dsh-pst-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4d6bfe);outline-offset:-1px}
[${HOST_ATTR}] .dsh-pst-btn[data-open="true"]{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary,currentColor))}
[${HOST_ATTR}] .dsh-pst-btn svg{display:block;width:12px;height:12px;transition:transform .16s ease}
[${HOST_ATTR}] .dsh-pst-btn[data-open="true"] svg{transform:rotate(90deg)}
[${HIDDEN_ATTR}]{display:none!important}
@media (prefers-reduced-motion:reduce){[${HOST_ATTR}] .dsh-pst-btn,[${HOST_ATTR}] .dsh-pst-btn svg{transition:none}}
`

    // ── 运行期状态 ──────────────────────────────────────────────────────

    /** 已经挂上的客户端上下文；HMR / 重复 apply 时用来避免重复注入。 */
    let appliedCtx = null

    /** 当前 Cordis 上下文。 */
    let ctx = null

    /** 插件区是否收起（true = 只留「插件」一行）。 */
    let collapsed = readCollapsed()

    /** 正在同步（避免 MutationObserver 被自己触发成死循环）。 */
    let syncing = false

    /** 一次 microtask 内只同步一次。 */
    let scheduled = false

    /** 观察器，卸载时断开。 */
    let observer = null

    // ── 小工具 ──────────────────────────────────────────────────────────

    /** 读取上次的折叠状态；存储被拒绝时按展开处理。 */
    function readCollapsed() {
      try {
        return window.localStorage.getItem(STORE_KEY) === '1'
      } catch {
        return false
      }
    }

    /** 写入折叠状态；存储被拒绝不影响本次会话的表现。 */
    function writeCollapsed(value) {
      try {
        window.localStorage.setItem(STORE_KEY, value ? '1' : '0')
      } catch {
        // 隐私模式或存储被禁用时，状态只在本次页面有效。
      }
    }

    /** 取当前客户端语言：拿不到就按英文处理。 */
    function currentLocale() {
      try {
        const active = ctx?.get?.('locale')?.getSnapshot?.()?.active
        if (typeof active === 'string' && COPY[active] !== undefined) return active
      } catch {
        // 语言服务不可用不影响功能，退回英文文案。
      }
      return 'en'
    }

    /** 取一句本地化提示文案。 */
    function copy(key) {
      const table = COPY[currentLocale()] ?? COPY.en
      return table[key] ?? COPY.en[key]
    }

    /**
     * 「插件」行在当前语言下的标签。
     * 优先从插槽注册表里读官方注册项自己的 label（随语言变化），
     * 读不到再用官方 8 种语言的兜底列表。
     */
    function expectedLabels() {
      const labels = new Set(FALLBACK_LABELS)
      try {
        const entries = ctx?.slots?.entriesOfSlot?.(PANEL_SLOT) ?? []
        for (const entry of entries) {
          const options = entry?.options ?? entry
          if (options?.id !== PANEL_ID) continue
          const raw = options?.label
          const text = typeof raw === 'function' ? raw() : raw
          if (typeof text === 'string' && text !== '') labels.add(text)
        }
      } catch {
        // 注册表读不到时只用兜底列表。
      }
      return labels
    }

    /**
     * 找到侧边栏那一列「全局面板」的 nav。
     * 锚点是侧边栏的折叠按钮 [data-sidebar-toggle]：它和 nav 同在侧边栏根节点里，
     * 所以从它往上走几层再向下找 nav，比猜 class 名稳。
     */
    function findSidebarNav() {
      const toggles = document.querySelectorAll('[data-sidebar-toggle]')
      for (const toggle of toggles) {
        let node = toggle
        for (let depth = 0; depth < 8 && node !== null; depth += 1) {
          const nav = node.querySelector?.('nav[aria-label]')
          if (nav !== null && nav !== undefined) return nav
          node = node.parentElement
        }
      }
      return null
    }

    /** 在面板列表里找到「插件」那一行的按钮。 */
    function findPluginsRow(nav, labels) {
      for (const button of nav.querySelectorAll('button[aria-label]')) {
        const label = (button.getAttribute('aria-label') ?? '').trim()
        if (labels.has(label)) return button
      }
      return null
    }

    /** 注入样式（重复调用无副作用）。 */
    function ensureStyle() {
      if (document.getElementById(STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.setAttribute('data-plugin', 'dsh-sidebar-plugins-toggle')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /** 移除样式。 */
    function removeStyle() {
      document.getElementById(STYLE_ID)?.remove()
    }

    /** 收起 / 展开插件区。 */
    function toggle() {
      collapsed = !collapsed
      writeCollapsed(collapsed)
      scheduleSync()
    }

    /**
     * 侧栏是否处于宽栏（有标题文字）。轨道模式下行里只有图标，
     * 此时不折叠、也不显示箭头。
     */
    function isWide(row) {
      return (row.textContent ?? '').trim() !== ''
    }

    /** 按当前状态刷新箭头的外观与无障碍属性。 */
    function paint(host, row) {
      const button = host.firstElementChild
      if (button === null) return
      const wide = isWide(row)
      const open = !collapsed
      const label = copy(open ? 'collapse' : 'expand')
      button.setAttribute('data-open', open ? 'true' : 'false')
      button.setAttribute('aria-expanded', open ? 'true' : 'false')
      button.setAttribute('aria-label', label)
      button.setAttribute('title', label)
      // 折叠成 56px 轨道时行里没有标题文字，此时把箭头藏起来，避免挤在图标格里。
      host.hidden = !wide
    }

    /**
     * 把 nav 里除了「插件」这一行之外的入口按状态收起或放出来。
     * 只处理 nav 的直接子节点：官方把每一行（以及「更多」的 Menu 锚点）渲染在这一层。
     */
    function applyCollapse(nav, row) {
      const wide = isWide(row)
      const hide = collapsed && wide
      for (const child of Array.from(nav.children)) {
        if (child === row || child.contains(row) || row.contains(child)) {
          if (child.getAttribute(HIDDEN_ATTR) !== null) child.removeAttribute(HIDDEN_ATTR)
          continue
        }
        if (hide) {
          if (child.getAttribute(HIDDEN_ATTR) === null) child.setAttribute(HIDDEN_ATTR, '')
        } else if (child.getAttribute(HIDDEN_ATTR) !== null) {
          child.removeAttribute(HIDDEN_ATTR)
        }
      }
    }

    /** 造出箭头按钮（只造一次，之后只刷新属性）。 */
    function buildControl(host) {
      const button = document.createElement('span')
      button.className = 'dsh-pst-btn'
      button.setAttribute('role', 'button')
      button.setAttribute('tabindex', '0')
      button.setAttribute('aria-expanded', 'true')
      button.innerHTML = CHEVRON_SVG

      // 捕获阶段拦下事件：不冒泡到行按钮，否则点箭头会顺带打开「插件」面板。
      const intercept = (event) => {
        event.preventDefault()
        event.stopPropagation()
      }
      button.addEventListener('pointerdown', intercept, true)
      button.addEventListener('click', (event) => {
        intercept(event)
        toggle()
      }, true)
      button.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        intercept(event)
        toggle()
      }, true)

      host.appendChild(button)
    }

    /** 把宿主节点挂到「插件」行尾部，并按状态刷新。 */
    function mountInto(nav, row) {
      if (row.getAttribute(ROW_ATTR) === null) row.setAttribute(ROW_ATTR, '')

      let host = row.querySelector(`:scope > [${HOST_ATTR}]`)
      if (host === null) {
        host = document.createElement('span')
        host.setAttribute(HOST_ATTR, '')
        row.appendChild(host)
      } else if (row.lastElementChild !== host) {
        // React 重渲染后（例如从轨道恢复成宽栏）把它挪回行尾。
        row.appendChild(host)
      }
      if (host.firstElementChild === null) buildControl(host)

      paint(host, row)
      applyCollapse(nav, row)
      return host
    }

    /** 同步一次：找行 → 挂箭头 → 收起/放出入门。幂等，找不到就安静退出。 */
    function sync() {
      if (ctx === null || syncing) return
      syncing = true
      try {
        const nav = findSidebarNav()
        if (nav === null) return
        const row = findPluginsRow(nav, expectedLabels())
        if (row === null) return
        mountInto(nav, row)
      } catch {
        // 同步失败不应影响界面，下一次 DOM 变化会再试。
      } finally {
        syncing = false
      }
    }

    /** 合并同一轮里的多次 DOM 变化，只同步一次。 */
    function scheduleSync() {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        scheduled = false
        sync()
      })
    }

    /** 清掉自己的痕迹（卸载 / HMR 时调用）。 */
    function teardown() {
      try {
        observer?.disconnect()
      } catch {
        // 观察器可能已经断开。
      }
      observer = null
      try {
        document.querySelectorAll(`[${HIDDEN_ATTR}]`).forEach((node) => node.removeAttribute(HIDDEN_ATTR))
        document.querySelectorAll(`[${ROW_ATTR}]`).forEach((node) => node.removeAttribute(ROW_ATTR))
        document.querySelectorAll(`[${HOST_ATTR}]`).forEach((node) => node.remove())
      } catch {
        // 文档可能正在销毁。
      }
      removeStyle()
      ctx = null
    }

    /** 启动：注入样式、挂箭头，并观察 DOM 变化。 */
    function start(context) {
      ctx = context
      ensureStyle()
      sync()

      // 侧边栏重渲染、语言切换、面板重新注册、折叠/展开侧栏都会改 DOM。
      if (typeof MutationObserver === 'function' && document.body !== null) {
        observer = new MutationObserver(scheduleSync)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      }
    }

    // ── Cordis 入口 ────────────────────────────────────────────────────

    /**
     * 客户端插件入口。
     * @param context - Cordis 客户端上下文
     */
    function apply(context) {
      // HMR 或 loader 重放会再次 apply 同一个实例，重复注入会长出第二个箭头。
      if (context === appliedCtx) return
      appliedCtx = context

      const boot = () => {
        try {
          start(context)
        } catch (error) {
          console.warn('[dsh-sidebar-plugins-toggle] 启动失败：', error)
        }
      }

      if (document.body === null) {
        document.addEventListener('DOMContentLoaded', boot, { once: true })
      } else {
        boot()
      }

      // 插件卸载时收干净。
      context.effect(() => {
        return () => {
          teardown()
          appliedCtx = null
        }
      }, 'dsh-sidebar-plugins-toggle: plugins-area chevron')
    }

    exports.name = name
    exports.apply = apply
    return module.exports
  },
})
