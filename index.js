/**
 * dsh-sidebar-plugins-toggle — Host 入口（空操作载体）。
 *
 * 功能全部在浏览器端（client.js）：在侧边栏「插件」行右侧挂一个展开/收起箭头。
 *
 * 这里只提供 Bundle 需要的可导入模块，确保 Loader 能解析到本包，
 * 并在「设置 › 插件」/「插件」页面里作为已安装条目显示。apply 不做事，
 * 因为桌面端把启动失败的插件条目视为致命错误，Host 端越空越安全。
 *
 * @module dsh-sidebar-plugins-toggle
 */

export const name = 'sidebar-plugins-toggle'

/** Host 端无需任何操作。 */
export function apply() {}
