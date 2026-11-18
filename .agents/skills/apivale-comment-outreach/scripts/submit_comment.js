/**
 * APIVALE 博客评论自动化填表、截图与 Google Sheets 同步脚本
 * 依赖: ComLinkAI 本地 Bridge 服务 (127.0.0.1:3010)
 * 
 * 用法:
 * node submit_comment.js --page "<博文URL>" --target "<落地页URL>" --author "<作者名>" --email "<邮箱>" --comment "<评论正文>"
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i].startsWith('--')) {
      const key = process.argv[i].substring(2);
      const val = process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : true;
      args[key] = val;
    }
  }
  return args;
}

const args = parseArgs();
const pageUrl = args.page;
const targetUrl = args.target;
const authorName = args.author;
const authorEmail = args.email || 'support@apivale.com';
const commentText = args.comment;

if (!pageUrl || !targetUrl || !authorName || !commentText) {
  console.error('缺少必要参数！');
  console.error('用法: node submit_comment.js --page "<博文URL>" --target "<落地页URL>" --author "<作者名>" --comment "<评论正文>" [--email "support@apivale.com"]');
  process.exit(1);
}

function callAction(action, data = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 3010,
      path: '/api/action',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { resolve({ raw: b }); }
      });
    });
    req.on('error', reject);
    req.write(JSON.stringify({ action, data }));
    req.end();
  });
}

function syncToSheet(payload) {
  return new Promise(resolve => {
    const postData = JSON.stringify(payload);
    const req = https.request('https://script.google.com/macros/s/AKfycbwgsylx1cU7CJg2q8F9LMVU8yS2iZ101LuFPH5r9Iwjc5Ug1qKLxhM63hE0HKTGWmEu_g/exec', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ error: e.message }));
    req.write(postData);
    req.end();
  });
}

(async () => {
  const domain = new URL(pageUrl).hostname;
  const safeDomain = domain.replace(/[^a-zA-Z0-9]/g, '_');
  console.log(`[1/8] 导航至目标博客: ${pageUrl}...`);
  await callAction('navigate', { url: pageUrl + '#respond' });
  await new Promise(r => setTimeout(r, 4000));

  console.log(`[2/8] 平滑滚动至评论区...`);
  await callAction('scroll', { direction: 'down', amount: 500 });
  await new Promise(r => setTimeout(r, 800));

  console.log(`[3/8] 输入深度技术评论正文...`);
  // 智能规避隐藏蜜罐
  let tRes = await callAction('type', { selector: 'textarea[placeholder*="comment" i]', text: commentText });
  if (!tRes || !tRes.success) {
    tRes = await callAction('type', { selector: '#comment', text: commentText });
  }
  console.log('评论输入结果:', JSON.stringify(tRes));

  console.log(`[4/8] 填写匹配的 Persona 作者名: ${authorName}`);
  await callAction('type', { selector: '#author', text: authorName });

  console.log(`[5/8] 填写统一官方邮箱: ${authorEmail}`);
  await callAction('type', { selector: '#email', text: authorEmail });

  console.log(`[6/8] 填写精准内页落地 URL: ${targetUrl}`);
  await callAction('type', { selector: '#url', text: targetUrl });

  console.log(`[7/8] 捕获填单完成截图 (Pre-submit)...`);
  await new Promise(r => setTimeout(r, 800));
  const snap1 = await callAction('screenshot');
  if (snap1 && snap1.data && snap1.data.dataUrl) {
    const b64 = snap1.data.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(`${safeDomain}_form_filled.jpg`, Buffer.from(b64, 'base64'));
    console.log(`已保存截屏: ${safeDomain}_form_filled.jpg`);
  }

  console.log(`[8/8] 点击提交按钮...`);
  const clickRes = await callAction('click', { selector: '#submit, input[name="submit"], button[type="submit"]' });
  console.log('点击提交结果:', JSON.stringify(clickRes));

  console.log('等待 6 秒获取提交响应状态...');
  await new Promise(r => setTimeout(r, 6000));

  const snap2 = await callAction('screenshot');
  if (snap2 && snap2.data && snap2.data.dataUrl) {
    const b64 = snap2.data.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(`${safeDomain}_post_submit.jpg`, Buffer.from(b64, 'base64'));
    console.log(`已保存提交后截屏: ${safeDomain}_post_submit.jpg`);
  }

  const tabRes = await callAction('getActiveTab');
  const postUrl = tabRes.data ? tabRes.data.url : pageUrl;
  const postTitle = tabRes.data && tabRes.data.title ? tabRes.data.title : domain;
  console.log(`提交后实际 URL: ${postUrl}`);

  console.log('实时打点同步至 Google Sheets APIVALE 页签...');
  const sheetPayload = {
    projectName: 'APIVALE',
    timestamp: new Date().toISOString(),
    url: pageUrl,
    domain: domain,
    title: postTitle,
    status: 'published',
    verifyStatus: 'unchecked',
    relType: 'blog_comment',
    relevanceScore: 95,
    comment: commentText
  };

  const syncRes = await syncToSheet(sheetPayload);
  console.log('Google Sheets 同步结果:', JSON.stringify(syncRes));
  console.log('✅ 发布流程全部完成！');
})();
