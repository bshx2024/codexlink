# 博客反爬虫与蜜罐避坑指南 (Honeypot Evasion Playbook)

在现代独立技术博客（特别是 WordPress 站点）中，大量安装了反垃圾评论插件（如 WP-Armour、Anti-Spam Bee、Akismet 等）。自动化提交若触碰其“蜜罐”，会导致请求被直接丢弃或被永久加入 Akismet 全网黑名单。

---

## 一、常见蜜罐类型与特征识别

### 1. 隐藏文本域蜜罐 (Hidden CSS Honeypots)
- **典型特征**：
  ```html
  <textarea id="comment" aria-label="hp-comment" style="display:none; position:absolute; left:-9999px;" tabindex="-1"></textarea>
  ```
- **工作机制**：正常人类读者看不到这个框，只有盲目抓取 DOM `#comment` 并填写的机器人会填入内容。一旦此框有值，直接封禁。
- **真实输入框**：插件会在上面生成另一个具有随机 id（如 `a2ca3b26da`）但 placeholder 为 `Leave a comment...` 的可见输入框，并通过前端 JS 在加载后动态将 id 改回 `comment`。
- **应对方案**：
  1. 优先使用可见选择器：`textarea[placeholder*="comment" i]`、`textarea:not([style*="display:none"]):not([tabindex="-1"])`；
  2. 必须等待浏览器完全执行前端 JavaScript 后再进行输入与提交。

### 2. Akismet 附加蜜罐域 (Akismet Honeypot Textarea)
- **典型特征**：
  ```html
  <textarea name="ak_hp_textarea" cols="45" rows="8" maxlength="100"></textarea>
  ```
- **工作机制**：通常通过 CSS 将父容器隐藏，专门抓取按名称乱填表单的自动化脚本。
- **应对方案**：在脚本选择器中严格过滤，只识别 `id="comment"` 或 `name="comment"`，绝不匹配包含 `ak_`、`hp_`、`hidden` 的字段。

### 3. 时间戳防刷机制 (Timestamp & Nonce Guards)
- **典型特征**：
  ```html
  <input type="hidden" name="ab_init_time" value="1794959585" />
  ```
- **工作机制**：要求从页面加载到点击提交之间必须有至少 3~5 秒的时间间隔。如果脚本在 500ms 内瞬间完成填写并点击，直接判定为机器并发并丢弃。
- **应对方案**：在页面加载完成、滚动到位、逐项输入和点击提交之间，人为加入 600ms ~ 1500ms 的自然拟人化延迟。

---

## 二、提交验证状态与审核凭证识别

当评论成功提交后，WordPress 站点通常会有以下几种状态：

1. **直接进入人工审核预览**（最健康、最普遍的状态）：
   - URL 出现特征：`?unapproved=XXXX&moderation-hash=YYYY#comment-XXXX`
   - 页面提示：*Your comment is awaiting moderation. This is a preview; your comment will be visible after it has been approved.*
2. **直接公开显示**：
   - URL 出现特征：`#comment-XXXX`
   - 页面已渲染出带有作者名字和网站外链的评论气泡。
3. **Jetpack / 外部评论框**：
   - 页面回跳至 `#respond`，表单重置或显示 *Your comment has been submitted*。

