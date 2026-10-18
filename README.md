# USTC BB 助手 (USTC BB Helper)

为中科大 bb 网络教学平台（Blackboard）增强的油猴脚本。基于 [PRO 的 USTC Helper](https://greasyfork.org/zh-CN/scripts/453530-ustc-helper)（GPL-3.0）的 bb 模块修复并独立而来，**无任何外部依赖**（原脚本因 `@require` 的 GitHub 依赖 404 而整体失效，本脚本已彻底移除此依赖）。

## 功能

- **作业区状态标注**：在作业列表自动标注每个作业的状态徽章 —— 已提交（绿）/ 未提交（红）/ 已评分（蓝，显示分数）/ 查询错误（黄）
- **点击忽略**：点击徽章可忽略某次作业（变灰半透明），再次点击取消；忽略记录存于 localStorage，主页未提交数目会同步更新
- **主页课程排序**：门户主页「当前学期课程」模块按未提交作业数排序 —— 红色「未提交 N」徽章降序置顶，「作业已交齐」居中，「无作业区」沉底；当日缓存，同一天内不重复查询
- **直达作业区**：主页点击课程名称直接进入该课程作业区，不再跳转课程主页（课程主页仍可从课程内左侧菜单进入）
- **自动登录**：登录页自动点击「统一身份认证登录」
- **校外自动认证**：`/nginx_auth/` 页面自动点击认证链接

## 安装

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 从 [Greasyfork](https://greasyfork.org/zh-CN/scripts/600725-ustc-bb-helper) 安装（推荐，可自动更新），或点击安装：[USTC-BB-Helper.user.js](https://github.com/quantai1314/ustc-bb-helper/raw/main/USTC-BB-Helper.user.js)

## 说明

- 仅匹配 `www.bb.ustc.edu.cn` / `bb.ustc.edu.cn`
- 状态查询通过 fetch 各作业页面实现，首次加载会消耗少量流量；主页排序结果当日缓存
- 所有数据仅存于浏览器本地（localStorage），不与任何第三方通信

## License

[GPL-3.0](LICENSE) — 与上游 USTC Helper 保持一致
