# 🚫 避坑与无效黑名单库 (Toxic / Closed / No-Backlink Blacklist)

> **建立目的**：记录在过往探测、抓取或实测中确认**已关闭评论**、**无外链输入框**、**包含恶意蜜罐**或**存在严重 Google 降权惩罚风险**的无效站点，防止团队与智能体重复消耗配额与时间。

---

## 避坑站点黑名单总表

| 域名 / 网址模式 | 拦截原因分类 | 详细诊断说明 | 处置规则 |
| :--- | :--- | :--- | :--- |
| **`*.medium.com` (无 Publication 认证的散户文章)** | 无有效外链传递 | Medium 评论区对所有外链均强制实施重定向跳转并带 `rel="nofollow ugc"`，且滥发评论极易封号。 | 仅限官方 Publication 发文，禁用评论区留痕。 |
| **部分已关闭评论的 WordPress 老博客** | 评论已关闭 (Comments Closed) | 页面显示 “Comments are closed” 或表单已被 `remove_action('comment_form')` 卸载。 | ComLinkAI 探针命中“关闭”关键字后直接跳过。 |
| **无 `Website / URL` 字段的评论表单** | 无法生成合法外链 | 某些站点的评论表单仅有 Name、Email、Comment 三项，无处留存合规外链；如果在正文贴链接会被 Akismet 直接判定为 SPAM。 | 自动标记为 `No-URL-Input`，移出任务池。 |
| **含隐藏 Honeypot 字段的高危表单** | 机器人陷阱 (Honeypot Trap) | 表单中包含隐藏的 `<input style="display:none" name="website_url">` 或带有诱饵字段。 | 严格执行 ComLinkAI 蜜罐过滤逻辑，跳过隐藏字段或放弃该站。 |
| **低质垃圾站 (Spammy PBNs / Content Farms)** | 严重负面 SEO 风险 | 网站大量充斥采集违规内容、赌博外链，Domain Authority 极低或已遭受 Google 算法降权。 | 立即拉入黑名单，严禁挂靠 APIVALE 任何链接。 |

---

## 自动化黑名单更新机制

- 当 ComLinkAI 侧边栏或探测脚本在扫描目标页面时，若发现：
  1. `isClosed === true`（评论区已关闭）；
  2. `hasForm === false`（无任何评论表单）；
  3. 表单提交后返回明显的垃圾站重定向；
- 系统将自动向此文件追加记录，确保后续任何批次任务不再触碰该目标。

