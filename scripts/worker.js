/**
 * Cloudflare Worker — AKB48 API CORS 代理
 *
 * 【用途】
 *   部署此 Worker 后，浏览器可以通过它绕过 CORS 限制
 *   直接获取 AKB48 官方 API 数据，实现「刷新数据」功能。
 *
 * 【部署方法（免费）】
 *   1. 登录 https://dash.cloudflare.com/
 *   2. 进入 Workers & Pages → 创建 Worker
 *   3. 把本文件内容粘贴进去 → 部署
 *   4. 部署后获得一个 URL: https://你的名字.workers.dev
 *   5. 在你的 GitHub Pages 网站上点击「刷新数据」时，
 *      在弹窗中输入该 Worker URL 即可。
 *
 * 【工作原理】
 *   浏览器 → (CORS!) → Cloudflare Worker → (无限制) → AKB48 API
 *
 * 【免费额度】
 *   Cloudflare 免费计划：每天 10 万次请求，完全够用。
 */

export default {
    async fetch(request) {
        const url = new URL(request.url);

        // 只代理 API 请求
        const apiTarget = 'https://www.akb48.co.jp/public/api/schedule/calendar/';

        // 转发到 AKB48 API（保持同样的 method 和 body）
        const proxyRequest = new Request(apiTarget, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0',
                'Referer': 'https://www.akb48.co.jp/about/schedule'
            },
            body: await request.text()
        });

        const response = await fetch(proxyRequest);
        const data = await response.json();

        // 添加 CORS 头，让浏览器接受返回的数据
        return new Response(JSON.stringify(data), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            }
        });
    }
};
