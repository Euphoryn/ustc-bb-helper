// ==UserScript==
// @name         USTC BB Helper
// @name:zh-CN   USTC BB 助手
// @license      gpl-3.0
// @namespace    ustc-bb-helper
// @version      1.2.2
// @description  Enhancements for USTC Blackboard: homework status badges (submitted / not submitted / graded), homepage courses sorted by unsubmitted homework with direct links to the homework area, auto login, auto authentication off campus. Standalone bb module based on PRO's USTC Helper (GPL-3.0), no external dependencies.
// @description:zh-CN  为中科大 bb 网络教学平台增强：作业区自动标注提交状态（已提交/未提交/已评分），支持点击忽略作业；主页「当前学期课程」按未提交作业数排序并显示数量徽章，点击课程直达作业区；自动点击统一身份认证登录；校外访问自动认证。基于 PRO 的 USTC Helper (GPL-3.0) bb 模块修复而来，无任何外部依赖。
// @match        https://www.bb.ustc.edu.cn/*
// @match        https://bb.ustc.edu.cn/*
// @icon         https://www.bb.ustc.edu.cn/images/ci/icons/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';
    const log = console.log.bind(console, "[USTC BB Helper]");
    const path = window.location.pathname;

    // ---------- 校外访问 / 登录页 ----------
    if (path === '/nginx_auth/') {
        // 校外访问时自动点击认证链接
        document.querySelector('a')?.click();
        return;
    }
    if (path === '/' || path === '/webapps/login/') {
        // 登录页自动点击「统一身份认证登录」
        document.querySelector('#login > table > tbody > tr > td:nth-child(2) > span > a')?.click();
        return;
    }

    const isContentList = path === '/webapps/blackboard/content/listContent.jsp'
        || path === '/webapps/blackboard/content/listContentEditable.jsp';
    const isPortal = path === '/webapps/portal/execute/tabs/tabAction';
    const isAssignment = path.startsWith('/webapps/assignment/');
    if (!isContentList && !isPortal && !isAssignment) return;

    // ---------- 共用 ----------
    const css = document.createElement('style');
    css.textContent = `
        .ustc-bb-hint {
            display: inline-block;
            margin-left: 6px;
            padding: 1px 8px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 600;
            line-height: 1.6;
            cursor: pointer;
            vertical-align: middle;
            user-select: none;
        }
        .ustc-bb-hint-0 { color: #6b7280; background: #f3f4f6; }
        .ustc-bb-hint-1 { color: #16a34a; background: #dcfce7; }
        .ustc-bb-hint-2 { color: #dc2626; background: #fee2e2; }
        .ustc-bb-hint-3 { color: #d97706; background: #fef3c7; }
        .ustc-bb-hint-4 { color: #6b7280; background: #f3f4f6; }
        .ustc-bb-hint-5 { color: #2563eb; background: #dbeafe; }
        .ustc-bb-ignored { opacity: 0.4; }
        .ustc-bb-ignored > .details { display: none; }
    `;
    document.head.appendChild(css);

    // 0: 查询中  1: 已提交  2: 未提交  3: 查询错误  4: 已忽略  5: 已评分
    const hintText = ['查询中', '已提交', '未提交', '查询错误', '已忽略', '已评分'];

    function getIgnored(courseId) {
        try {
            return JSON.parse(localStorage.getItem('ustc-bb-ignored:' + courseId) || '[]');
        } catch (e) {
            return [];
        }
    }

    const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD 本地时区

    // 使主页缓存中某门课的条目失效（忽略/提交作业后数目会变）
    function invalidatePortal(courseId) {
        try {
            const raw = JSON.parse(localStorage.getItem('ustc-bb-portal') || 'null');
            if (raw && raw.data && raw.data[courseId]) {
                delete raw.data[courseId];
                localStorage.setItem('ustc-bb-portal', JSON.stringify(raw));
            }
        } catch (e) { /* ignore */ }
    }

    // 用作业区的实时统计结果回写主页缓存（仅当缓存是今天的，否则主页会全量重查）
    function syncPortalCount(courseId, unsub, url) {
        try {
            const raw = JSON.parse(localStorage.getItem('ustc-bb-portal') || 'null');
            if (raw && raw.date === today && raw.data) {
                raw.data[courseId] = { u: unsub, hw: true, url };
                localStorage.setItem('ustc-bb-portal', JSON.stringify(raw));
            }
        } catch (e) { /* ignore */ }
    }

    function ignoreHw(courseId, contentId, ignore) {
        let ignored = getIgnored(courseId);
        if (ignore && !ignored.includes(contentId)) {
            ignored.push(contentId);
            log(`Ignoring "${courseId}/${contentId}"...`);
        } else if (!ignore && ignored.includes(contentId)) {
            ignored = ignored.filter((v) => v != contentId);
            log(`Un-ignoring "${courseId}/${contentId}"...`);
        }
        if (ignored.length) localStorage.setItem('ustc-bb-ignored:' + courseId, JSON.stringify(ignored));
        else localStorage.removeItem('ustc-bb-ignored:' + courseId);
    }

    async function queryStatus(link) {
        try {
            const r = await fetch(link);
            if (!r.ok) {
                log(`Failed to fetch "${r.url}": ${r.status} ${r.statusText}`);
                return [3, null];
            }
            const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
            const title = doc.getElementById('pageTitleText')?.textContent?.trim() ?? '';
            if (title.startsWith('上载作业')) {
                return [2, null];
            } else if (title.startsWith('复查提交历史记录')) {
                const grade = doc.getElementById('aggregateGrade');
                const suffix = doc.getElementById('aggregateGrade_pointsPossible');
                const score = grade ? parseFloat(grade.value) : NaN;
                if (!isNaN(score)) {
                    return [5, `${score}${suffix ? suffix.textContent.trim() : ''}`];
                }
                return [1, null];
            }
            return [3, null];
        } catch (e) {
            console.warn(`[USTC BB Helper] Query "${link}" failed:`, e);
            return [3, null];
        }
    }

    // 统计一门课作业区里「未提交」的数量（不含已忽略）；返回 { u, hw, url }
    // u: 未提交数（-1 表示查询出错）；hw: 是否存在作业区；url: 作业区地址
    async function countUnsubmitted(courseId) {
        try {
            const r = await fetch(`/webapps/blackboard/execute/launcher?type=Course&id=${courseId}&url=`);
            if (!r.ok) return { u: -1, hw: true, url: null };
            const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
            const anchors = Array.from(doc.querySelectorAll('a[href*="listContent.jsp"]'));
            const hwAnchor = anchors.find(a => a.textContent.includes('作业区')) || anchors[0];
            if (!hwAnchor) return { u: 0, hw: false, url: null };
            const hwUrl = new URL(hwAnchor.getAttribute('href'), location.origin).href;
            const r2 = await fetch(hwUrl);
            if (!r2.ok) return { u: -1, hw: true, url: hwUrl };
            const doc2 = new DOMParser().parseFromString(await r2.text(), 'text/html');
            const list = doc2.getElementById('content_listContainer');
            if (!list) return { u: 0, hw: true, url: hwUrl };
            const ignored = getIgnored(courseId);
            let unsub = 0;
            const jobs = [];
            for (const hw of list.children) {
                const a = hw.querySelector('h3 > a');
                if (!a) continue;
                const href = a.getAttribute('href') || '';
                if (!href.includes('/webapps/assignment/')) continue;
                const link = new URL(href, location.origin);
                const contentId = link.searchParams.get('content_id');
                if (contentId && ignored.includes(contentId)) continue;
                jobs.push(queryStatus(link.href).then(([s]) => { if (s === 2) unsub++; }));
            }
            await Promise.all(jobs);
            return { u: unsub, hw: true, url: hwUrl };
        } catch (e) {
            console.warn(`[USTC BB Helper] Query course "${courseId}" failed:`, e);
            return { u: -1, hw: true, url: null };
        }
    }

    // ---------- 作业区：标注每个作业的提交状态 ----------
    function initHwList() {
        const pageTitle = document.getElementById('pageTitleText')?.children[0]?.textContent?.trim();
        if (pageTitle !== '作业区') return;
        const hwList = document.getElementById('content_listContainer');
        if (!hwList) {
            console.warn("[USTC BB Helper] 'content_listContainer' not found, skipped.");
            return;
        }

        // 记录每个作业的实时状态，全部查询完成后回写主页缓存的未提交数
        const counts = new Map(); // contentId -> status
        let pending = 0;
        function syncPortal(courseId) {
            if (pending) return;
            let unsub = 0;
            for (const s of counts.values()) if (s === 2) unsub++;
            syncPortalCount(courseId, unsub, location.href);
        }

        async function process(hw) {
            const linkEl = hw.querySelector('h3 > a');
            if (!linkEl) return;
            const link = linkEl.href;
            if (!link.includes('/webapps/assignment/')) return;
            const hint = linkEl.appendChild(document.createElement('span'));
            const setHint = (status, extra) => {
                hint.className = `ustc-bb-hint ustc-bb-hint-${status}`;
                hint.textContent = `${hintText[status]}${extra ? ' ' + extra : ''}`;
            };
            let status = 0, extra = null;
            setHint(status);
            const params = new URL(link).searchParams;
            const courseId = params.get('course_id');
            const contentId = params.get('content_id');
            pending++;
            let ignored = getIgnored(courseId).includes(contentId);
            if (ignored) {
                status = 4;
                linkEl.closest('li')?.classList.add('ustc-bb-ignored');
                log(`"${courseId}/${contentId}" present in ignore list, ignored.`);
            } else {
                [status, extra] = await queryStatus(link);
                if (status === 1) log(`"${courseId}/${contentId}" is submitted.`);
                else if (status === 2) log(`"${courseId}/${contentId}" is not submitted.`);
                else if (status === 5) log(`"${courseId}/${contentId}" is graded.`);
                else if (status === 3) console.warn(`[USTC BB Helper] Online query "${courseId}/${contentId}" failed!`);
            }
            setHint(status, extra);
            counts.set(contentId, status);
            pending--;
            syncPortal(courseId);
            hint.title = ignored ? '点击取消忽略此作业' : '点击忽略此作业';
            hint.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                ignoreHw(courseId, contentId, !ignored);
                ignored = !ignored;
                if (ignored) {
                    linkEl.closest('li')?.classList.add('ustc-bb-ignored');
                    setHint(4);
                    hint.title = '点击取消忽略此作业';
                    counts.set(contentId, 4);
                    syncPortal(courseId);
                } else {
                    linkEl.closest('li')?.classList.remove('ustc-bb-ignored');
                    setHint(0);
                    hint.title = '点击忽略此作业';
                    counts.set(contentId, 0);
                    pending++;
                    queryStatus(link).then(([s, ex]) => {
                        setHint(s, ex);
                        counts.set(contentId, s);
                        pending--;
                        syncPortal(courseId);
                    });
                }
            });
        }

        for (const hw of hwList.children) {
            process(hw);
        }
    }

    // ---------- 主页「当前学期课程」：按未提交作业数排序 ----------
    function initPortal() {
        const h2 = Array.from(document.querySelectorAll('h2'))
            .find(e => e.textContent.includes('当前学期课程'));
        if (!h2) return;
        const mod = h2.closest('.portlet');
        const ul = mod?.querySelector('ul.courseListing');
        if (!ul) return;

        const items = Array.from(ul.children).map(li => {
            const a = li.querySelector('a[href*="type=Course"]');
            if (!a) return null;
            let courseId = null;
            try {
                courseId = new URL(a.href, location.origin).searchParams.get('id');
            } catch (e) { /* ignore */ }
            if (!courseId) return null;
            const badge = a.appendChild(document.createElement('span'));
            badge.className = 'ustc-bb-hint ustc-bb-hint-0';
            badge.textContent = '作业查询中…';
            badge.style.cursor = 'default';
            return { li, a, courseId, badge, unsub: -1, hasHw: true };
        }).filter(Boolean);
        if (!items.length) return;

        // 当日缓存：同一天内不重复查询
        let cache = {};
        try {
            const raw = JSON.parse(localStorage.getItem('ustc-bb-portal') || 'null');
            if (raw && raw.date === today && raw.data) cache = raw.data;
        } catch (e) { /* ignore */ }
        const saveCache = () => {
            try {
                localStorage.setItem('ustc-bb-portal', JSON.stringify({ date: today, data: cache }));
            } catch (e) { /* ignore */ }
        };

        function updateBadge(item) {
            if (!item.hasHw) {
                item.badge.className = 'ustc-bb-hint ustc-bb-hint-0';
                item.badge.textContent = '无作业区';
            } else if (item.unsub > 0) {
                item.badge.className = 'ustc-bb-hint ustc-bb-hint-2';
                item.badge.textContent = `未提交 ${item.unsub}`;
            } else if (item.unsub === 0) {
                item.badge.className = 'ustc-bb-hint ustc-bb-hint-1';
                item.badge.textContent = '作业已交齐';
            } else {
                item.badge.className = 'ustc-bb-hint ustc-bb-hint-3';
                item.badge.textContent = '查询错误';
            }
        }

        const jobs = items.map(async (item) => {
            const cached = cache[item.courseId];
            // 旧版本缓存没有 url 字段，视为过期并重新查询
            if (cached && typeof cached.u === 'number' && 'url' in cached) {
                item.unsub = cached.u;
                item.hasHw = cached.hw;
                if (cached.url) item.a.href = cached.url; // 直达作业区
            } else {
                const res = await countUnsubmitted(item.courseId);
                item.unsub = res.u;
                item.hasHw = res.hw;
                if (res.url) item.a.href = res.url; // 直达作业区
                cache[item.courseId] = res;
                saveCache();
                log(`Course ${item.courseId}: ${res.hw ? `unsubmitted ${res.u}` : 'no homework area'}.`);
            }
            updateBadge(item);
        });

        Promise.all(jobs).then(() => {
            // 排序：未提交多的在前；都交齐的居中；无作业区/查询错误的在最后
            const key = (item) => {
                if (item.hasHw && item.unsub > 0) return -item.unsub;
                if (item.hasHw && item.unsub === 0) return 0;
                return 1;
            };
            const sorted = items.slice().sort((a, b) => key(a) - key(b));
            for (const item of sorted) ul.appendChild(item.li);
            log('Courses sorted by unsubmitted homework count.');
        });
    }

    if (isContentList) initHwList();
    else if (isPortal) initPortal();
    else {
        // 查看/提交作业后状态可能变化，使主页缓存中该课程的数目失效
        const cid = new URLSearchParams(location.search).get('course_id');
        if (cid) invalidatePortal(cid);
    }
})();
