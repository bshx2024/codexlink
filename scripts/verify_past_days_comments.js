const fs = require('fs');

const inputRecords = JSON.parse(fs.readFileSync('scripts/target_records_19_20.json', 'utf8'));

console.log(`准备检测 11-19 与 11-20 的记录，共 ${inputRecords.length} 条...`);

const PERSONAS = [
  'Elena Rostova',
  'Sofia Costa',
  'Alex Rivera',
  'Sarah Chen',
  'Kenji Tanaka',
  'Chen Wei',
  'Aris Thorne'
];

async function checkSingleUrl(record) {
  const targetUrl = record.url;
  const result = {
    rowNum: record.rowNum,
    bjDate: record.bjDate,
    utcDate: record.utcDate,
    url: targetUrl,
    domain: record.domain,
    title: record.title,
    status: 'unknown',
    relType: 'none',
    matchedLink: null,
    httpCode: 0,
    note: ''
  };

  if (!targetUrl || !targetUrl.startsWith('http')) {
    result.status = 'invalid_url';
    result.note = '无效 URL';
    return result;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);
    result.httpCode = resp.status;

    if (!resp.ok) {
      result.status = 'http_error';
      result.note = `HTTP ${resp.status}`;
      return result;
    }

    const html = await resp.text();

    // 1. 检查是否存在 apivale.com 外链
    const apivaleMatch = html.match(/<a\s+[^>]*href=["']([^"']*apivale\.com[^"']*)["'][^>]*>(.*?)<\/a>/i);
    const bareMatch = html.includes('apivale.com');

    if (apivaleMatch) {
      result.status = 'approved_live';
      const fullTag = apivaleMatch[0];
      const href = apivaleMatch[1];
      const anchor = apivaleMatch[2].replace(/<[^>]+>/g, '').trim();
      const isNofollow = /rel=["'][^"']*(nofollow|ugc)[^"']*["']/i.test(fullTag);
      result.relType = isNofollow ? 'live_nofollow' : 'live_dofollow';
      result.matchedLink = { href, anchor, fullTag: fullTag.slice(0, 150) };
      result.note = `外链已公开上线 (${result.relType})`;
      return result;
    } else if (bareMatch) {
      // 页面中出现了 apivale.com 文本但未渲染成 <a> 或在评论正文中
      result.status = 'approved_live';
      result.relType = 'text_mention';
      result.note = '页面中包含 apivale.com 文本标记';
      return result;
    }

    // 2. 检查是否处于待审核 (Pending) 状态
    let hasAuthor = false;
    for (const p of PERSONAS) {
      if (html.includes(p)) {
        hasAuthor = true;
        result.matchedAuthor = p;
        break;
      }
    }

    const cleanCommentSnippet = record.comment ? record.comment.slice(0, 35) : '';
    const hasSnippet = cleanCommentSnippet && html.includes(cleanCommentSnippet);
    const hasModerationNotice = /awaiting moderation|moderation queue|comment is being reviewed/i.test(html);

    if (hasAuthor || hasSnippet || hasModerationNotice) {
      result.status = 'pending_moderation';
      result.note = '评论处于博主审核中 (待批复上线)';
      return result;
    }

    // 3. 既无外链也无审核提示
    result.status = 'not_live';
    result.note = '未检测到公开外链或留言（博主尚未批复或已过滤）';
    return result;

  } catch (err) {
    const isTimeout = err.name === 'AbortError' || err.message.includes('abort');
    result.status = isTimeout ? 'timeout' : 'network_error';
    result.note = isTimeout ? '请求超时 (8s)' : err.message;
    return result;
  }
}

// 并发批处理
async function batchCheck(records, concurrency = 8) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < records.length) {
      const current = records[index++];
      const r = await checkSingleUrl(current);
      results.push(r);
      const icon = r.status === 'approved_live' ? '🟢' : (r.status === 'pending_moderation' ? '🟡' : (r.status === 'http_error' ? '🔴' : '⚪'));
      console.log(`[${results.length}/${records.length}] ${icon} 行#${r.rowNum} [${r.bjDate}] ${r.domain} -> ${r.status} (${r.note})`);
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

(async () => {
  console.log('开始并发探测...');
  const startTime = Date.now();
  const results = await batchCheck(inputRecords, 10);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n======================================================`);
  console.log(`检测完成！总耗时: ${duration} 秒，检测记录: ${results.length}`);

  // 分类统计
  const stats = {
    total: results.length,
    byDate: {},
    byStatus: {}
  };

  results.forEach(r => {
    // 按日期
    if (!stats.byDate[r.bjDate]) stats.byDate[r.bjDate] = { total: 0, approved: 0, pending: 0, not_live: 0, error: 0 };
    stats.byDate[r.bjDate].total++;
    if (r.status === 'approved_live') stats.byDate[r.bjDate].approved++;
    else if (r.status === 'pending_moderation') stats.byDate[r.bjDate].pending++;
    else if (r.status === 'not_live') stats.byDate[r.bjDate].not_live++;
    else stats.byDate[r.bjDate].error++;

    // 按状态
    stats.byStatus[r.status] = (stats.byStatus[r.status] || 0) + 1;
  });

  console.log('状态统计:', stats.byStatus);
  console.log('日期统计:', stats.byDate);

  fs.writeFileSync('scripts/verification_results.json', JSON.stringify(results, null, 2), 'utf8');
  fs.writeFileSync('scripts/verification_stats.json', JSON.stringify(stats, null, 2), 'utf8');
  console.log('结果已保存至 scripts/verification_results.json 和 scripts/verification_stats.json');
})();

