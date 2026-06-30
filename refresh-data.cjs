#!/usr/bin/env node
/**
 * refresh-data.cjs — AKB48 公演データ自動更新スクリプト
 *
 * 使用方法:
 *   node refresh-data.cjs
 *
 * 動作:
 *   1. AKB48公式APIから直近6ヶ月のスケジュールを取得
 *   2. メンバー一覧を取得
 *   3. 劇場公演（parent_category === "1"）のみ抽出
 *   4. メンバーID → 氏名のマッピングを生成
 *   5. data.js 互換の EMBEDDED_DATA / MEMBER_MAP を出力
 *
 * 所要時間: 通常 1〜3 秒
 */

const https = require('https');
const http = require('http');
const querystring = require('querystring');

const API_HOST = 'www.akb48.co.jp';
const SCHEDULE_PATH = '/public/api/schedule/calendar/';
const MEMBER_PATH = '/public/api/member/list/';
const REFERER = 'https://www.akb48.co.jp/about/schedule';

// ---- HTTP ヘルパー ----

function postForm(host, path, data) {
    return new Promise((resolve, reject) => {
        const body = querystring.stringify(data);
        const options = {
            hostname: host,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': REFERER
            }
        };
        const req = https.request(options, (res) => {
            let chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(Buffer.concat(chunks).toString()));
                } catch (e) {
                    reject(new Error('JSON parse error'));
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ---- メイン ----

async function main() {
    console.log('🔍 AKB48 公演データを取得中...\n');

    // 1. メンバー一覧を取得
    console.log('👤 メンバー一覧を取得中...');
    const memberData = await postForm(API_HOST, MEMBER_PATH, {});
    if (memberData.result !== 'ok') throw new Error('Member API error');

    const members = memberData.data;
    const memberCount = Object.keys(members).length;
    console.log(`   ✓ ${memberCount}名のメンバーを取得`);

    // 2. 直近6ヶ月のスケジュールを取得（現在月を基準）
    const now = new Date();
    const allSchedule = {};
    const fetchMonths = [];

    for (let i = -2; i <= 4; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        fetchMonths.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    for (const { year, month } of fetchMonths) {
        process.stdout.write(`📅 ${year}年${month}月のスケジュールを取得中...`);
        try {
            const data = await postForm(API_HOST, SCHEDULE_PATH, {
                month: String(month),
                year: String(year),
                category: '0'
            });
            if (data.result === 'ok' && data.data.thismonth) {
                const keys = Object.keys(data.data.thismonth);
                // 劇場公演（cat=1）のみを抽出
                const theaterOnly = {};
                for (const [k, events] of Object.entries(data.data.thismonth)) {
                    const rawTheater = events.filter(e => e.parent_category === '1');
                    const theaterEvents = rawTheater.map(e => {
                        let time = '';
                        const body = e.body || '';
                        const m = body.match(/(\d{2}:\d{2})開演/);
                        if (m) time = m[1];
                        else if (e.title !== '休館日' && e.title !== '公演内容未定') {
                            const m2 = body.match(/(\d{2}:\d{2})/);
                            if (m2) time = m2[1];
                        }
                        return { title: e.title || '公演内容未定', time, members: e.member || '' };
                    });
                    if (theaterEvents.length > 0) {
                        theaterOnly[k] = theaterEvents;
                    }
                }
                Object.assign(allSchedule, theaterOnly);
                console.log(` ✓ ${keys.length}日分（うち劇場公演: ${Object.keys(theaterOnly).length}日）`);
            } else {
                console.log(` ✗ データなし`);
            }
        } catch (e) {
            console.log(` ✗ エラー: ${e.message}`);
        }
    }

    // 3. 出力生成
    const sortedKeys = Object.keys(allSchedule).sort();
    console.log(`\n📊 合計: ${sortedKeys.length}日分の劇場公演データ`);

    // ---- MEMBER_MAP 生成 ----
    console.log('\n=== メンバーマッピング（MEMBER_MAP）===');
    const memberEntries = Object.entries(members)
        .sort((a, b) => {
            // 数値ID順
            const na = parseInt(a[0]), nb = parseInt(b[0]);
            if (na !== nb) return na - nb;
            return a[0].localeCompare(b[0]);
        });

    for (const [id, m] of memberEntries) {
        console.log(`    "${id}": "${m.name}",`);
    }

    // ---- EMBEDDED_DATA 生成 ----
    console.log('\n=== 埋め込み公演データ（EMBEDDED_DATA）===');
    console.log('const EMBEDDED_DATA = {');

    let currentMonth = '';
    for (const key of sortedKeys) {
        const events = allSchedule[key];
        const monthPrefix = key.substring(0, 7);
        if (monthPrefix !== currentMonth) {
            currentMonth = monthPrefix;
            console.log(`\n    // ---- ${key.replace('_', '年').replace('_', '月')}月 ----`);
        }

        const formatted = events.map(e => {
            const title = e.title || '公演内容未定';
            const time = e.time || '';
            const members = e.members || '';
            return `{ title: "${title}", time: "${time}", members: "${members}" }`;
        });

        if (formatted.length === 1) {
            console.log(`    "${key}": [${formatted[0]}],`);
        } else {
            console.log(`    "${key}": [`);
            formatted.forEach((f, i) => {
                const comma = i < formatted.length - 1 ? ',' : '';
                console.log(`        ${f}${comma}`);
            });
            console.log(`    ],`);
        }
    }
    console.log('};');

    console.log('\n✅ 完了！上記の出力を js/data.js に反映してください。');
}

main().catch(e => {
    console.error('❌ エラー:', e.message);
    process.exit(1);
});
