/**
 * ComLinkAI - Backlink Pipeline 6-Table Atomic Database Engine
 * 实现了对标刘小排体系的 6 张核心共享表与状态机流转：
 * 1. devto_outbound_links: 文章原始出站外链流水
 * 2. ai_tool_sites: 提纯后的独立 AI/SaaS 种子库
 * 3. referrer_targets: 外链任务主队列（支持 claimed_by 原子锁与状态流转）
 * 4. referrer_success: 长期成果库（收录追踪 listed_status 与证据截图）
 * 5. referrer_probes: 未成功探针池（记录跳过原因、DOM特征、留待二轮复检）
 * 6. site_knowledge: 产品站点资产知识库（多路由 1200x737 实拍整屏图、品牌文案）
 */

const fs = require('fs');
const path = require('path');

class BacklinkDatabase {
  constructor(dbDir) {
    this.dbDir = dbDir || path.join(__dirname, '..', 'data');
    this.dbFile = path.join(this.dbDir, 'backlink_db.json');
    this.initialized = false;

    this.tables = {
      devto_outbound_links: [],
      ai_tool_sites: [],
      referrer_targets: [],
      referrer_success: [],
      referrer_probes: [],
      site_knowledge: []
    };

    this.autoIncs = {
      devto_outbound_links: 1,
      ai_tool_sites: 1,
      referrer_targets: 1,
      referrer_success: 1,
      referrer_probes: 1,
      site_knowledge: 1
    };
  }

  init() {
    if (this.initialized) return;
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }

    if (fs.existsSync(this.dbFile)) {
      try {
        const raw = fs.readFileSync(this.dbFile, 'utf8');
        const parsed = JSON.parse(raw);
        for (const key of Object.keys(this.tables)) {
          if (Array.isArray(parsed.tables?.[key])) {
            this.tables[key] = parsed.tables[key];
          }
        }
        if (parsed.autoIncs) {
          this.autoIncs = { ...this.autoIncs, ...parsed.autoIncs };
        }
      } catch (err) {
        console.error('[BacklinkDB] 读取已有数据库失败，初始化空白库:', err.message);
      }
    } else {
      this.flushSync();
    }

    this.initialized = true;
    console.log('[BacklinkDB] 6-Table 架构数据库就绪。当前指标:', this.getStats());
  }

  flushSync() {
    const tmp = `${this.dbFile}.${Date.now()}.tmp`;
    const payload = JSON.stringify({
      version: '2.0.0',
      updated_at: new Date().toISOString(),
      autoIncs: this.autoIncs,
      tables: this.tables
    }, null, 2);

    fs.writeFileSync(tmp, payload, 'utf8');
    fs.renameSync(tmp, this.dbFile);
  }

  // ================= 1. devto_outbound_links =================
  addOutboundLinks(links = []) {
    this.init();
    let added = 0;
    const existing = new Set(
      this.tables.devto_outbound_links.map(l => `${l.article_id}_${l.outbound_url}`)
    );

    for (const link of links) {
      const key = `${link.article_id}_${link.outbound_url}`;
      if (existing.has(key)) continue;

      const record = {
        id: this.autoIncs.devto_outbound_links++,
        article_id: link.article_id || 0,
        article_title: link.article_title || '',
        article_url: link.article_url || '',
        author: link.author || '',
        tags: Array.isArray(link.tags) ? link.tags.join(',') : (link.tags || ''),
        outbound_url: link.outbound_url,
        domain: link.domain || '',
        link_text: link.link_text || '',
        is_social: link.is_social ? 1 : 0,
        is_directory: link.is_directory ? 1 : 0,
        is_candidate: link.is_candidate ? 1 : 0,
        created_at: new Date().toISOString()
      };

      this.tables.devto_outbound_links.push(record);
      existing.add(key);
      added++;
    }

    if (added > 0) this.flushSync();
    return { added, total: this.tables.devto_outbound_links.length };
  }

  // ================= 2. ai_tool_sites =================
  addToolSeeds(seeds = []) {
    this.init();
    let added = 0;
    const existingDomains = new Set(this.tables.ai_tool_sites.map(s => s.domain.toLowerCase()));

    for (const seed of seeds) {
      const domain = (seed.domain || '').toLowerCase().trim();
      if (!domain || existingDomains.has(domain)) continue;

      const record = {
        id: this.autoIncs.ai_tool_sites++,
        site_name: seed.site_name || domain,
        domain: domain,
        url: seed.url || `https://${domain}`,
        category: seed.category || 'ai-tools',
        source_domain: seed.source_domain || 'dev.to',
        source_article_url: seed.source_article_url || '',
        anchor_text: seed.anchor_text || '',
        why_included: seed.why_included || 'dev.to independent AI seed',
        created_at: new Date().toISOString()
      };

      this.tables.ai_tool_sites.push(record);
      existingDomains.add(domain);
      added++;
    }

    if (added > 0) this.flushSync();
    return { added, total: this.tables.ai_tool_sites.length };
  }

  getToolSeeds(limit = 100) {
    this.init();
    return this.tables.ai_tool_sites.slice(0, limit);
  }

  // ================= 3. referrer_targets =================
  addReferrerTargets(targets = []) {
    this.init();
    let added = 0;
    const successDomains = new Set(this.tables.referrer_success.map(s => s.target_domain.toLowerCase()));
    const existingKeys = new Set(
      this.tables.referrer_targets.map(t => `${t.target_domain.toLowerCase()}_${t.link_page_url || ''}`)
    );

    for (const t of targets) {
      const targetDomain = (t.target_domain || '').toLowerCase().trim();
      const linkPage = (t.link_page_url || '').trim();
      const key = `${targetDomain}_${linkPage}`;

      // 若已在成功库或队列中已存在，则去重跳过
      if (!targetDomain || successDomains.has(targetDomain) || existingKeys.has(key)) continue;

      const record = {
        id: this.autoIncs.referrer_targets++,
        target_domain: targetDomain,
        source_site: t.source_site || '',
        link_page_url: linkPage,
        anchor_text: t.anchor_text || '',
        link_type: t.link_type || 'dofollow',
        status: 'pending', // 'pending', 'sending', 'sent', 'failed', 'skipped'
        claimed_by: null,
        attempts: 0,
        last_error: null,
        notes: t.notes || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      this.tables.referrer_targets.push(record);
      existingKeys.add(key);
      added++;
    }

    if (added > 0) this.flushSync();
    return { added, total: this.tables.referrer_targets.length };
  }

  /**
   * 原子性领取待处理任务（排它锁）
   */
  claimNextTargets(limit = 1, claimedBy = 'autopilot-worker') {
    this.init();
    const claimed = [];
    const now = new Date().toISOString();

    for (const item of this.tables.referrer_targets) {
      if (item.status === 'pending') {
        item.status = 'sending';
        item.claimed_by = claimedBy;
        item.attempts = (item.attempts || 0) + 1;
        item.updated_at = now;
        claimed.push({ ...item });
        if (claimed.length >= limit) break;
      }
    }

    if (claimed.length > 0) this.flushSync();
    return claimed;
  }

  // ================= 4. referrer_success =================
  recordSuccess(targetId, data = {}) {
    this.init();
    const target = this.tables.referrer_targets.find(t => t.id === targetId);
    const domain = (data.target_domain || target?.target_domain || '').toLowerCase();
    const now = new Date().toISOString();

    if (target) {
      target.status = 'sent';
      target.updated_at = now;
      target.notes = data.notes || target.notes;
    }

    const successRecord = {
      id: this.autoIncs.referrer_success++,
      target_id: targetId,
      target_domain: domain,
      submit_entry_url: data.submit_entry_url || target?.link_page_url || '',
      submit_method: data.submit_method || 'form',
      source_site: data.source_site || target?.source_site || '',
      link_page_url: target?.link_page_url || '',
      anchor_text: target?.anchor_text || '',
      link_type: target?.link_type || 'dofollow',
      listed_status: data.listed_status || 'pending_review', // 'pending_review', 'listed', 'rejected'
      listed_url: data.listed_url || null,
      listed_verified_at: data.listed_verified_at || null,
      evidence_path: data.evidence_path || null,
      notes: data.notes || '',
      submitted_by: data.submitted_by || target?.claimed_by || 'autopilot',
      submitted_at: now,
      created_at: now,
      updated_at: now
    };

    this.tables.referrer_success.push(successRecord);
    this.flushSync();
    return successRecord;
  }

  // ================= 5. referrer_probes =================
  recordProbe(targetId, data = {}) {
    this.init();
    const target = this.tables.referrer_targets.find(t => t.id === targetId);
    const domain = (data.target_domain || target?.target_domain || '').toLowerCase();
    const now = new Date().toISOString();

    if (target) {
      target.status = data.final_status || 'skipped'; // 'skipped' 或 'failed'
      target.last_error = data.skip_reason || 'probed_unresolved';
      target.updated_at = now;
    }

    const probeRecord = {
      id: this.autoIncs.referrer_probes++,
      target_id: targetId,
      target_domain: domain,
      link_page_url: data.link_page_url || target?.link_page_url || '',
      skip_reason: data.skip_reason || 'unknown',
      probe_mode: data.probe_mode || 'form', // 'none', 'dead', 'email', 'form', 'submit', 'captcha', 'paid'
      page_bytes: data.page_bytes || 0,
      submit_links: Array.isArray(data.submit_links) ? data.submit_links.join(',') : (data.submit_links || ''),
      has_mailto: data.has_mailto ? 1 : 0,
      has_form: data.has_form ? 1 : 0,
      has_captcha: data.has_captcha ? 1 : 0,
      recheck_count: 0,
      recheck_notes: data.recheck_notes || '',
      probed_at: now,
      updated_at: now
    };

    this.tables.referrer_probes.push(probeRecord);
    this.flushSync();
    return probeRecord;
  }

  // ================= 6. site_knowledge =================
  saveKnowledge(item = {}) {
    this.init();
    const existingIdx = this.tables.site_knowledge.findIndex(
      k => k.kind === item.kind && k.category === (item.category || '') && k.item_key === item.item_key
    );

    const now = new Date().toISOString();
    const record = {
      id: existingIdx >= 0 ? this.tables.site_knowledge[existingIdx].id : this.autoIncs.site_knowledge++,
      kind: item.kind || 'profile', // 'profile', 'screenshot', 'submit_kit'
      category: item.category || '',
      item_key: item.item_key,
      item_value: item.item_value || '',
      source_url: item.source_url || '',
      page_url: item.page_url || '',
      file_path: item.file_path || '',
      width: item.width || 0,
      height: item.height || 0,
      notes: item.notes || '',
      verified_at: now,
      captured_at: item.captured_at || now,
      created_at: existingIdx >= 0 ? this.tables.site_knowledge[existingIdx].created_at : now,
      updated_at: now
    };

    if (existingIdx >= 0) {
      this.tables.site_knowledge[existingIdx] = record;
    } else {
      this.tables.site_knowledge.push(record);
    }

    this.flushSync();
    return record;
  }

  getKnowledge(kind, item_key) {
    this.init();
    return this.tables.site_knowledge.find(
      k => (kind ? k.kind === kind : true) && (item_key ? k.item_key === item_key : true)
    );
  }

  // ================= 查询统计与巡检 =================
  getStats() {
    this.init();
    const targetStatus = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
    for (const t of this.tables.referrer_targets) {
      if (targetStatus[t.status] !== undefined) {
        targetStatus[t.status]++;
      }
    }

    return {
      outbound_links: this.tables.devto_outbound_links.length,
      tool_seeds: this.tables.ai_tool_sites.length,
      targets: {
        total: this.tables.referrer_targets.length,
        ...targetStatus
      },
      success_total: this.tables.referrer_success.length,
      probes_total: this.tables.referrer_probes.length,
      knowledge_items: this.tables.site_knowledge.length
    };
  }

  listTargets({ status, limit = 50, offset = 0 } = {}) {
    this.init();
    let res = this.tables.referrer_targets;
    if (status) {
      res = res.filter(t => t.status === status);
    }
    return res.slice(offset, offset + limit);
  }

  listProbes({ probe_mode, limit = 50, offset = 0 } = {}) {
    this.init();
    let res = this.tables.referrer_probes;
    if (probe_mode) {
      res = res.filter(p => p.probe_mode === probe_mode);
    }
    return res.slice(offset, offset + limit);
  }

  listSuccess({ listed_status, limit = 50, offset = 0 } = {}) {
    this.init();
    let res = this.tables.referrer_success;
    if (listed_status) {
      res = res.filter(s => s.listed_status === listed_status);
    }
    return res.slice(offset, offset + limit);
  }
}

module.exports = new BacklinkDatabase();

