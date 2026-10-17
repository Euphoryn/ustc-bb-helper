// ==UserScript==
// @name         USTC BB Helper
// @name:zh-CN   USTC BB 助手
// @license      gpl-3.0
// @namespace    ustc-bb-helper
// @version      1.1.0
// @description  Enhancements for USTC Blackboard: homework status badges (submitted / not submitted / graded), homepage courses sorted by unsubmitted homework, auto login, auto authentication off campus. Standalone bb module based on PRO's USTC Helper (GPL-3.0), no external dependencies.
// @description:zh-CN  为中科大 bb 网络教学平台增强：作业区自动标注提交状态（已提交/未提交/已评分），支持点击忽略作业；主页「当前学期课程」按未提交作业数排序并显示数量徽章；自动点击统一身份认证登录；校外访问自动认证。基于 PRO 的 USTC Helper (GPL-3.0) bb 模块修复而来，无任何外部依赖。
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
    if (!isContentList && !isPortal) return;

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

    // 统计一门课作业区里「未提交」的数量（不含已忽略）；返回 { u, hw }
    // u: 未提交数（-1 表示查询出错）；hw: 是否存在作业区
    async function countUnsubmitted(courseId) {
        try {
            const r = await fetch(`/webapps/blackboard/execute/launcher?type=Course&id=${courseId}&url=`);
            if (!r.ok) return { u: -1, hw: true };
            const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
            const anchors = Array.from(doc.querySelectorAll('a[href*="listContent.jsp"]'));
            const hwAnchor = anchors.find(a => a.textContent.includes('作业区')) || anchors[0];
            if (!hwAnchor) return { u: 0, hw: false };
            const hwUrl = new URL(hwAnchor.getAttribute('href'), location.origin).href;
            const r2 = await fetch(hwUrl);
            if (!r2.ok) return { u: -1, hw: true };
            const doc2 = new DOMParser().parseFromString(await r2.text(), 'text/html');
            const list = doc2.getElementById('content_listContainer');
            if (!list) return { u: 0, hw: true };
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
            return { u: unsub, hw: true };
        } catch (e) {
            console.warn(`[USTC BB Helper] Query course "${courseId}" failed:`, e);
            return { u: -1, hw: true };
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
                } else {
                    linkEl.closest('li')?.classList.remove('ustc-bb-ignored');
                    setHint(0);
                    hint.title = '点击忽略此作业';
                    queryStatus(link).then(([s, ex]) => setHint(s, ex));
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
            return { li, courseId, badge, unsub: -1, hasHw: true };
        }).filter(Boolean);
        if (!items.length) return;

        // 当日缓存：同一天内不重复查询
        const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD 本地时区
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
            if (cached && typeof cached.u === 'number') {
                item.unsub = cached.u;
                item.hasHw = cached.hw;
            } else {
                const res = await countUnsubmitted(item.courseId);
                item.unsub = res.u;
                item.hasHw = res.hw;
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
    else initPortal();
})();
