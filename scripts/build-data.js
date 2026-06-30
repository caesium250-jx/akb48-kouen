#!/usr/bin/env node
/**
 * build-data.js — 直接从 AKB48 API 获取数据并写入 js/data.js
 *
 * 用途:
 *   - GitHub Actions 自动更新
 *   - 本地手动更新: node scripts/build-data.js
 *
 * 输出: 直接修改 js/data.js 文件
 */

const fs = require('fs');
const https = require('https');
const qs = require('querystring');

const DATA_FILE = __dirname + '/../js/data.js';
const API_HOST = 'www.akb48.co.jp';

function post(host, path, data) {
    return new Promise((resolve, reject) => {
        const body = qs.stringify(data);
        const opts = {
            hostname: host, path, method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.akb48.co.jp/about/schedule'
            }
        };
        const r = https.request(opts, res => {
            let c = []; res.on('data', d => c.push(d));
            res.on('end', () => {
                try { resolve(JSON.parse(Buffer.concat(c))); }
                catch (e) { reject(new Error('JSON parse error')); }
            });
        });
        r.on('error', reject); r.write(body); r.end();
    });
}

async function main() {
    console.log('[build-data] Fetching member list...');
    const memberRes = await post(API_HOST, '/public/api/member/list/', {});
    if (memberRes.result !== 'ok') throw new Error('Member API failed');
    const members = memberRes.data;

    // Build MEMBER_MAP (sorted by ID, names without spaces)
    const memberEntries = Object.entries(members)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .map(([id, m]) => `    "${id}": "${m.name.replace(/\s+/g, '')}"`);
    const memberMapStr = 'const MEMBER_MAP = {\n' + memberEntries.join(',\n') + '\n};\n';

    // 获取当前月前后各3个月（共6个月）的数据
    const now = new Date();
    const fetchMonths = [];
    for (let i = -2; i <= 3; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        fetchMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    console.log(`[build-data] Fetching schedule (${fetchMonths.length} months)...`);

    // ユーティリティ
    function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // 名前 → ID の逆引きマップ
    const nameToId = {};
    for (const [id, m] of Object.entries(members)) {
        nameToId[m.name.replace(/\s+/g, '')] = id;
    }

    const allData = {};
    for (const { year, month: m } of fetchMonths) {
        try {
            const res = await post(API_HOST, '/public/api/schedule/calendar/', {
                month: m, year: 2026, category: '0'
            });
            if (res.data && res.data.thismonth) {
                for (const [k, events] of Object.entries(res.data.thismonth)) {
                    const theater = events
                        .filter(e => e.parent_category === '1')
                        .map(e => {
                            let time = '';
                            let notice = '';
                            let subtitle = '';
                            const body = e.body || '';
                            const text = body.replace(/<[^>]*>/g, '').trim();

                            // ---- 開演時間 ----
                            const tm = text.match(/(\d{2}:\d{2})開演/);
                            if (tm) time = tm[1];
                            else if (e.title !== '休館日' && e.title !== '公演内容未定') {
                                const tm2 = text.match(/(\d{2}:\d{2})/);
                                if (tm2) time = tm2[1];
                            }

                            // ---- メンバー変更をパースして実際のmembersに反映 ----
                            let members = e.member || '';
                            // テキスト中の既知メンバー名を使った休演パターンを検出
                            // 「※名前が休演となり、代わりに名前が出演いたします。」
                            // 最初の※（券説明）ではなく、出演メンバー後の※を狙うため
                            // 既知メンバー名を含むものだけを対象にする
                            for (const nm of Object.keys(nameToId)) {
                                const re = new RegExp('※' + escapeRegex(nm) + 'が休演となり、代わりに(.+?)が出演いたします。');
                                const cm = text.match(re);
                                if (cm) {
                                    const removedName = nm;
                                    const addedName = cm[1].trim();
                                    notice = `※${removedName}が休演、代わりに${addedName}が出演`;

                                    const removedId = nameToId[removedName];
                                    const addedId = nameToId[addedName];
                                    if (removedId && addedId && members) {
                                        const idList = members.split(',').filter(Boolean);
                                        const filtered = idList.filter(id => id !== removedId);
                                        if (!filtered.includes(addedId)) filtered.push(addedId);
                                        members = filtered.join(',');
                                    }
                                    break;
                                }
                            }

                            // ---- subtitle: 生誕祭・卒業公演（メンバー名付き） ----
                            // 既知のメンバー名 + 生誕祭/卒業公演 を検出
                            const knownNames = Object.keys(nameToId).sort((a, b) => b.length - a.length);
                            for (const nm of knownNames) {
                                const re = new RegExp(escapeRegex(nm) + '[ 　](生誕祭|卒業公演)');
                                const nmMatch = text.match(re);
                                if (nmMatch) {
                                    subtitle = nm + ' ' + nmMatch[1];
                                    break;
                                }
                            }
                            // タイトルに卒業公演が含まれるが上記で拾えなかった場合
                            if (e.title.includes('卒業公演') && !subtitle) {
                                const gradName = e.title.replace('卒業公演', '').trim();
                                subtitle = gradName + ' 卒業公演';
                            }
                            // 名前なしで生誕祭のみの場合
                            if (!subtitle && text.includes('生誕祭')) {
                                subtitle = '生誕祭';
                            }

                            // ---- title を特殊公演向けに整形 ----
                            let title = e.title || '公演内容未定';

                            return { title, time, members, notice, subtitle };
                        });
                    if (theater.length) allData[k] = theater;
                }
                console.log(`  ${year}年${m}月 ✓ (${Object.keys(res.data.thismonth).length} days)`);
            }
        } catch (e) {
            console.error(`  ${year}年${m}月 ✗ ${e.message}`);
        }
    }

    // Build EMBEDDED_DATA
    const sortedKeys = Object.keys(allData).sort();
    const dataLines = ['const EMBEDDED_DATA = {'];
    let currentMonth = '';
    for (const key of sortedKeys) {
        const events = allData[key];
        const mp = key.slice(0, 7);
        if (mp !== currentMonth) {
            currentMonth = mp;
            const [y, m] = key.split('_');
            dataLines.push(`\n    // ---- ${y}年${parseInt(m)}月 ----`);
        }
        const formatted = events.map(e => {
            const t = e.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const n = e.notice ? e.notice.replace(/"/g, '\\"') : '';
            const s = e.subtitle || '';
            return `{ title: "${t}", time: "${e.time}", members: "${e.members}", notice: "${n}", subtitle: "${s}" }`;
        });
        if (formatted.length === 1) {
            dataLines.push(`    "${key}": [${formatted[0]}],`);
        } else {
            dataLines.push(`    "${key}": [`);
            formatted.forEach((f, i) => dataLines.push(`        ${f}${i < formatted.length - 1 ? ',' : ''}`));
            dataLines.push(`    ],`);
        }
    }
    dataLines.push('};');

    const embeddedDataStr = dataLines.join('\n') + '\n';

    // Write to file
    const header = '/**\n * data.js — AKB48 メンバーマッピング & 埋め込み公演データ\n * 自動生成: scripts/build-data.js\n * 更新日: ' + new Date().toISOString().slice(0, 10) + '\n */\n\n';
    const output = header + memberMapStr + '\n' + embeddedDataStr;

    fs.writeFileSync(DATA_FILE, output, 'utf8');
    console.log(`\n[build-data] ✓ ${DATA_FILE} 已更新`);
    console.log(`[build-data]   ${Object.keys(members).length} 名メンバー, ${sortedKeys.length} 日分の公演データ`);
}

main().catch(e => { console.error('[build-data] ✗', e.message); process.exit(1); });
