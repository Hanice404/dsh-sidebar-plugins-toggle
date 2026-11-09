// 用真实 Chrome 跑一遍 client.js：造一份和官方侧边栏同构的 DOM，
// 验证箭头挂在「插件」行尾部、点击只收起同级入口、方向/文案/localStorage 正确、
// 轨道模式不折叠、整行替换后自愈、卸载能收干净。
//
// 运行：node tests/sidebar-dom.test.mjs
// 需要本机有 Chrome / Chromium；可用 CHROME_BIN 指定可执行文件。
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const clientSource = readFileSync(join(root, 'client.js'), 'utf8')
const workDir = join(tmpdir(), 'dsh-sidebar-plugins-toggle-test')
const htmlPath = join(workDir, 'harness.html')

/** 找 Chrome：先看 CHROME_BIN，再看各平台常见路径与 PATH。 */
function findChrome() {
  const fromEnv = process.env.CHROME_BIN
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'chrome']) {
    try {
      const found = execSync(`command -v ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (found !== '') return found
    } catch {
      // 这个名字没有，试下一个。
    }
  }
  return null
}

const chrome = findChrome()
if (chrome === null) {
  console.error('找不到 Chrome/Chromium；请用 CHROME_BIN=/path/to/chrome 指定。')
  process.exit(1)
}

const html = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>dsh-sidebar-plugins-toggle harness</title></head>
<body>
<div id="app">
  <div data-window-drag><button data-sidebar-toggle aria-label="收起侧边栏"></button></div>
  <div><button class="brand" aria-label="新建会话"></button></div>
  <button class="newSession" aria-label="新建会话">新会话</button>
  <nav aria-label="全局面板">
    <button aria-label="插件" id="row-plugins"><span class="glyph"><svg></svg></span><span class="title">插件</span></button>
    <button aria-label="插件市场" id="row-market"><span class="glyph"><svg></svg></span><span class="title">插件市场</span></button>
    <button aria-label="上下文洞察" id="row-context"><span class="glyph"><svg></svg></span><span class="title">上下文洞察</span></button>
    <div class="moreAnchor"><button aria-label="更多" id="row-more"><span class="glyph"><svg></svg></span><span class="title">更多</span></button></div>
  </nav>
  <div class="region"></div>
</div>
<pre id="result">PENDING</pre>
<script>
  let captured = null
  window.__ModuleLoader__ = { load(mod) { captured = mod } }

  const state = { active: null }
  const subs = new Set()
  const calls = []
  const services = {
    locale: { getSnapshot: () => ({ active: 'zh' }) },
    layout: {
      panelInfo: {
        getSnapshot: () => ({ activePanelId: state.active }),
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
      },
      selectPanel(id) { calls.push(id); state.active = id; for (const fn of subs) fn() },
    },
  }
  let disposer = null
  const ctx = {
    effect(fn) { disposer = fn(); return disposer },
    get(name) { return services[name] },
    slots: { entriesOfSlot: () => [{ options: { id: 'plugins', order: 0, label: () => '插件' } }] },
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const results = {}
  const check = (name, ok, extra) => { results[name] = ok ? 'PASS' : 'FAIL' + (extra ? ' — ' + extra : '') }
  const hidden = (el) => el.getAttribute('data-dsh-pst-hidden') !== null
  const visible = (el) => getComputedStyle(el).display !== 'none'

  window.addEventListener('load', async () => {
    try {
      const mod = captured.factory(() => ({}))
      mod.apply(ctx)
      await wait(60)

      const row = document.getElementById('row-plugins')
      const host = row.querySelector('[data-dsh-pst-host]')
      const siblings = [document.getElementById('row-market'), document.getElementById('row-context'), document.querySelector('.moreAnchor')]
      const btn = host && host.firstElementChild

      check('host-mounted', host !== null)
      check('host-is-last-child', row.lastElementChild === host)
      check('button-built', !!btn && btn.classList.contains('dsh-pst-btn'))
      check('default-expanded', btn.getAttribute('data-open') === 'true' && btn.getAttribute('aria-expanded') === 'true')
      check('default-label', btn.getAttribute('aria-label') === '收起插件区', btn.getAttribute('aria-label'))
      check('default-all-visible', siblings.every(visible))

      let rowClicks = 0
      row.addEventListener('click', () => { rowClicks += 1 })

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await wait(60)
      check('collapse-hides-siblings', siblings.every(hidden) && siblings.every((el) => !visible(el)))
      check('collapse-keeps-anchor-row', visible(row))
      check('collapse-does-not-open-panel', calls.length === 0, JSON.stringify(calls))
      check('collapse-not-hijack-row', rowClicks === 0, 'rowClicks=' + rowClicks)
      check('collapsed-chevron', btn.getAttribute('data-open') === 'false' && btn.getAttribute('aria-label') === '展开插件区', btn.getAttribute('aria-label'))
      check('collapsed-persisted', localStorage.getItem('dsh-sidebar-plugins-toggle:collapsed') === '1')
      check('collapsed-arrow-still-in-row', host.parentElement === row && row.lastElementChild === host)

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await wait(60)
      check('expand-restores', siblings.every((el) => !hidden(el)) && siblings.every(visible))
      check('expanded-chevron', btn.getAttribute('data-open') === 'true')

      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      await wait(40)
      row.querySelector('.title').remove()
      await wait(60)
      check('rail-hides-arrow', host.hidden === true)
      check('rail-shows-all-entries', siblings.every((el) => !hidden(el)))

      const title = document.createElement('span')
      title.className = 'title'
      title.textContent = '插件'
      row.appendChild(title)
      await wait(60)
      check('wide-restores-collapse', host.hidden === false && siblings.every(hidden))
      check('wide-keeps-trailing', row.lastElementChild === host)

      const before = btn.getAttribute('data-open')
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
      await wait(50)
      check('keyboard-toggles', btn.getAttribute('data-open') !== before)

      const fresh = document.createElement('button')
      fresh.setAttribute('aria-label', '插件')
      fresh.id = 'row-plugins'
      fresh.innerHTML = '<span class="glyph"><svg></svg></span><span class="title">插件</span>'
      row.replaceWith(fresh)
      await wait(80)
      check('remount-after-rerender', fresh.querySelector('[data-dsh-pst-host]') !== null && fresh.lastElementChild.getAttribute('data-dsh-pst-host') !== null)

      disposer()
      await wait(50)
      check('teardown-host', document.querySelector('[data-dsh-pst-host]') === null)
      check('teardown-style', document.getElementById('dsh-sidebar-plugins-toggle-style') === null)
      check('teardown-hidden-attrs', document.querySelectorAll('[data-dsh-pst-hidden]').length === 0)
      check('teardown-row-attrs', document.querySelectorAll('[data-dsh-pst-row]').length === 0)

      document.getElementById('result').textContent = JSON.stringify(results, null, 2)
    } catch (error) {
      document.getElementById('result').textContent = 'ERROR ' + (error && error.stack || error)
    }
  })
</script>
<script>${clientSource}</script>
</body></html>`

rmSync(workDir, { recursive: true, force: true })
mkdirSync(workDir, { recursive: true })
writeFileSync(htmlPath, html)

const dump = execFileSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--user-data-dir=${join(workDir, 'chrome-profile')}`,
  '--virtual-time-budget=5000',
  '--dump-dom',
  `file://${htmlPath}`,
], { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })

const match = dump.match(/<pre id="result">([\s\S]*?)<\/pre>/)
if (match === null) {
  console.error('没有拿到测试结果：\n' + dump.slice(0, 3000))
  process.exit(1)
}

const text = match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
console.log(text)

let parsed
try {
  parsed = JSON.parse(text)
} catch {
  console.error('测试结果不是 JSON：' + text.slice(0, 500))
  process.exit(1)
}

const failed = Object.entries(parsed).filter(([, value]) => value !== 'PASS')
if (Object.keys(parsed).length === 0) {
  console.error('一条检查都没跑。')
  process.exit(1)
}
if (failed.length > 0) {
  console.error(`\n${failed.length} 项失败：` + failed.map(([name]) => ' ' + name).join(','))
  process.exit(1)
}
console.log(`\n全部通过：${Object.keys(parsed).length} 项`)
