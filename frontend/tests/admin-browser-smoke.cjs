const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

// handler: обслуживает фикстуру для проверки экрана без игрового сервера.
async function main() {
  const dist = path.resolve(__dirname, '../dist');
  let prompt = 'Исходный промпт';
  let locationsConfigured = false;
  let locationId = 'one';
  const server = http.createServer((request, response) => {
    if (request.url === '/api/v1/admin/state') {
      response.setHeader('Content-Type', 'application/json');
      const locations = locationsConfigured ? [{id:'one',occupants:[]},{id:'two',occupants:[{playerId:'other',username:'Другой'}]},{id:'three',occupants:[]}] : [];
      response.end(JSON.stringify({ players:[{ id:'one', username:'Анна', locationId, position:{x:10,z:10}, connectedAt:'2026-01-01T09:00:00Z', fps:60, ping:24 }], locations, chunks:[{x:0,z:0,size:64,roads:[]}] }));
      return;
    }
    if (request.url === '/api/v1/admin/players/one/location' && request.method === 'POST') {
      let body = ''; request.on('data', chunk => { body += chunk; });
      request.on('end', () => { locationId = JSON.parse(body).locationId; response.statusCode = 204; response.end(); });
      return;
    }
    if (request.url === '/api/v1/admin/prompt') {
      response.setHeader('Content-Type', 'application/json');
      if (request.method === 'POST') {
        let body = ''; request.on('data', chunk => { body += chunk; });
        request.on('end', () => { prompt = JSON.parse(body).prompt; response.statusCode = 204; response.end(); });
      } else response.end(JSON.stringify({prompt,defaultPrompt:'Исходный промпт'}));
      return;
    }
    const name = request.url === '/admin/' ? 'index.html' : decodeURIComponent(request.url.slice(1));
    const file = path.resolve(dist, name);
    if (!file.startsWith(dist + path.sep)) { response.statusCode = 404; response.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { response.statusCode = 404; response.end(); return; }
      response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
    const page = await browser.newPage({viewport:{width:1280,height:800}});
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/`);
    await page.getByRole('heading', {name:'Панель администратора'}).waitFor();
    await page.getByText('Анна').waitFor();
    assert.equal(await page.getByLabel('Локация игрока Анна').isDisabled(), true);
    assert.match(await page.locator('#admin-players').innerText(), /24 мс.*60/);
    assert.equal(await page.locator('#admin-map').evaluate(e => getComputedStyle(e).position), 'static');
    await page.getByRole('button', {name:'Системный промпт'}).click();
    await page.waitForFunction(() => document.querySelector('#prompt-text')?.value === 'Исходный промпт');
    assert.equal(await page.getByLabel('Системный промпт').inputValue(), 'Исходный промпт');
    await page.getByRole('button', {name:'Редактировать'}).click();
    await page.getByLabel('Системный промпт').fill('Изменённый промпт');
    await page.getByRole('button', {name:'Сохранить'}).click();
    await page.waitForFunction(() => document.querySelector('#prompt-text')?.readOnly === true);
    assert.equal(prompt, 'Изменённый промпт');
    await page.getByRole('button', {name:'Редактировать'}).click();
    await page.getByRole('button', {name:'По умолчанию'}).click();
    assert.equal(await page.getByLabel('Системный промпт').inputValue(), 'Исходный промпт');
    await page.getByRole('button', {name:'Отмена'}).click();
    assert.equal(await page.getByLabel('Системный промпт').inputValue(), 'Изменённый промпт');
    await page.getByRole('button', {name:'Закрыть'}).click();
    locationsConfigured = true;
    await page.reload();
    const locations = page.getByLabel('Локация игрока Анна');
    await locations.waitFor();
    assert.equal(await locations.locator('option[value="two"]').isDisabled(), true);
    await locations.selectOption('three');
    await page.waitForFunction(() => document.querySelector('select')?.value === 'three' && !document.querySelector('select')?.disabled);
    assert.equal(locationId, 'three');
    console.log('Admin UI fixture smoke passed');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
