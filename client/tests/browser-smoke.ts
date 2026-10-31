// Browser test with explicit HTTP/WS fixtures; does not establish real multiplayer.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { previewChunk } from "../src/dev/preview";
const base = process.env.CLIENT_URL ?? "http://localhost:4173";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH
    ? { executablePath: process.env.CHROMIUM_PATH }
    : {}),
  args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors: string[] = [];
  const external: string[] = [];
  const sent: any[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== new URL(base).origin)
      external.push(request.url());
  });
  // Block external traffic: all assets required by this scene must be local.
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === new URL(base).origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(base);
  await page.click("#preview");
  await page.waitForTimeout(500);
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1200);
  await page.keyboard.up("KeyW");
  assert.ok(Number(await page.locator("#speed").textContent()) >= 5);
  await page.keyboard.down("Space");
  await page.waitForTimeout(1500);
  await page.keyboard.up("Space");
  assert.equal(await page.locator("#speed").textContent(), "0");
  await page.screenshot({ path: "/tmp/hahaton-cockpit.png" });
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(200);
  assert.match((await page.locator("#hint").textContent()) ?? "", /ходьба/);
  await page.keyboard.press("KeyE");
  await page.waitForTimeout(200);
  assert.match((await page.locator("#hint").textContent()) ?? "", /выйти/);
  await page.click("#leave-preview");
  // Repeated preview teardown should return to the same retained geometry/texture count.
  await page.waitForTimeout(150);
  const resources = async () =>
    (await page.locator("#diag").textContent())?.match(
      /Геометрии: \d+ · текстуры: \d+/,
    )?.[0];
  const baseline = await resources();
  for (let i = 0; i < 3; i++) {
    await page.click("#preview");
    await page.waitForTimeout(200);
    await page.click("#leave-preview");
    await page.waitForTimeout(200);
    assert.equal(await resources(), baseline);
  }

  let sockets = 0;
  page.on("websocket", () => sockets++);
  await page.route("**/api/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Нужен вход" } }),
    }),
  );
  await page.click("#reconnect");
  await page.locator("#notice").filter({ hasText: "Нужен вход" }).waitFor();
  assert.equal(sockets, 0);
  await page.unroute("**/api/me");
  await page.route("**/api/me", (route) =>
    route.fulfill({
      json: { user: { id: "p1", username: "Тест" }, progress: [] },
    }),
  );
  const fixture = previewChunk();
  fixture.id = "test-chunk";
  fixture.accountedBytes = 1000;
  await page.route("**/api/world/meta", (route) =>
    route.fulfill({
      json: {
        version: "test",
        totalWorldBytes: 100000,
        cacheBudgetBytes: 8000,
        accounting: "canonical-uncompressed-unique-world-data",
      },
    }),
  );
  await page.route("**/api/world/chunks/test-chunk", (route) =>
    route.fulfill({ json: fixture }),
  );
  const player = {
    id: "p1",
    username: "Тест",
    position: { x: 2.5, y: 0, z: 8 },
    yaw: 0,
    mode: "driving",
    vehicleId: "v1",
  };
  const remote = {
    ...player,
    id: "p2",
    username: "Другой ученик",
    vehicleId: "v2",
  };
  const vehicles = [
    {
      id: "v1",
      driverId: "p1",
      variant: "blue",
      position: player.position,
      yaw: 0,
      speed: 0,
    },
    {
      id: "v2",
      driverId: "p2",
      variant: "green",
      position: { x: -2.5, y: 0, z: -4 },
      yaw: 0,
      speed: 0,
    },
  ];
  await page.routeWebSocket("**/ws", (ws) => {
    const send = (type: string, payload: unknown) =>
      ws.send(JSON.stringify({ v: 1, type, payload }));
    send("session.ready", {
      selfId: "p1",
      tickRate: 20,
      player,
      vehicles,
      progress: [],
    });
    send("world.interest", {
      allowedChunkIds: ["test-chunk"],
      removeChunkIds: [],
      cacheBudgetBytes: 8000,
    });
    send("state.snapshot", {
      tick: 1,
      serverTime: Date.now(),
      ackInputSeq: 0,
      players: [player, remote],
      vehicles,
    });
    ws.onMessage((data) => {
      const m = JSON.parse(String(data));
      sent.push(m);
      if (m.type === "chat.send")
        send("chat.message", {
          senderId: "p1",
          username: "Тест",
          text: m.payload.text,
          serverTime: Date.now(),
        });
    });
  });
  await page.click("#reconnect");
  await page.locator("#connection").filter({ hasText: "Подключено" }).waitFor();
  await page.waitForFunction(() =>
    document.getElementById("diag")?.textContent?.includes("1.00%"),
  );
  await page.locator("#chat-form input").fill("<b>Привет</b>");
  await page.locator("#chat-form button").click();
  await page
    .locator("#chat-log")
    .filter({ hasText: "<b>Привет</b>" })
    .waitFor();
  assert.equal(await page.locator("#chat-log b").count(), 0);
  await page.screenshot({ path: "/tmp/hahaton-network-fixture.png" });
  await page.waitForTimeout(150);
  assert.ok(sent.some((m) => m.type === "player.input"));
  assert.ok(sent.some((m) => m.type === "chat.send"));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: production scene, acceleration/brake, exit/re-enter, denied session, v0.1 HTTP/WS fixtures, chunk accounting, literal chat text; no page errors or external requests.",
  );
  console.log(
    "HTTP/WS are fixtures. Real server, multiplayer, persistence, AI and LAN remain unverified.",
  );
} finally {
  await browser.close();
}
